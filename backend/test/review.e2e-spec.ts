import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import { PasswordHasher } from '@nestjs/authentication';
import { FakeModel, overrideModels } from '@nestjs/ai/testing';
import { InMemoryDisk, STORAGE_MODULE_OPTIONS } from '@nestjs/storage';
import { inArray } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { users } from '../src/db/schema.js';
import type { Db } from '../src/db/types.js';

const PASSWORD = 'ValidPassword123';
const EMAIL_A = 'phase3-a@example.com';
const EMAIL_B = 'phase3-b@example.com';

let seq = 0;
const jpeg = () =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`jpeg-${Date.now()}-${seq++}`),
  ]);

const leche = {
  rawDescription: 'LECHE ENTERA 1100ML',
  quantity: 2,
  unit: 'und',
  unitPrice: 5000,
  discount: 0,
  lineTotal: 10000,
  matchedProductId: null,
  suggestedProduct: {
    name: 'Leche entera',
    category: 'Lácteos',
    baseUnit: 'ml',
    baseSize: 1100,
  },
};
// Ni producto del catálogo ni sugerencia: el usuario tiene que elegirlo.
const pan = {
  rawDescription: 'PAN TAJADO',
  quantity: 1,
  unit: 'und',
  unitPrice: 2500,
  discount: 0,
  lineTotal: 2500,
  matchedProductId: null,
  suggestedProduct: null,
};

const extraction = (overrides: Record<string, unknown> = {}) => ({
  object: {
    readable: true,
    unreadableReason: null,
    purchasedAt: '2026-01-15',
    total: 12500,
    nit: null,
    cufe: null,
    items: [leche, pan],
    ...overrides,
  },
});

const unreadable = () =>
  extraction({
    readable: false,
    unreadableReason: 'oscura',
    purchasedAt: null,
    total: null,
    items: [],
  });

const newPan = {
  name: 'Pan tajado',
  category: 'Panadería',
  baseUnit: 'und',
  baseSize: 1,
};

describe('Revisar y confirmar (e2e)', () => {
  let app: INestApplication<App>;
  let db: Db;
  let proxySecret: string;
  const model = new FakeModel();
  const disk = new InMemoryDisk();
  const user = { a: { id: '', cookie: '' }, b: { id: '', cookie: '' } };

  const api = (who: keyof typeof user) => {
    const server = app.getHttpServer();
    const auth = <T extends request.Test>(req: T) =>
      req.set('x-proxy-secret', proxySecret).set('Cookie', user[who].cookie);
    return {
      get: (path: string) => auth(request(server).get(path)),
      patch: (path: string) => auth(request(server).patch(path)),
      post: (path: string) => auth(request(server).post(path)),
      delete: (path: string) => auth(request(server).delete(path)),
    };
  };

  const upload = async (
    who: keyof typeof user,
    reply: ReturnType<typeof extraction>,
    fields: Record<string, string>,
  ) => {
    model.reply(reply);
    const req = api(who).post('/receipts');
    for (const [name, value] of Object.entries(fields)) req.field(name, value);
    const res = await req.attach('images', jpeg(), 'foto.jpg').expect(201);
    return res.body as {
      receipt: { id: string; storeId: string };
      items: { id: string }[];
    };
  };

  beforeAll(async () => {
    const moduleRef = await overrideModels(
      Test.createTestingModule({ imports: [AppModule] }),
      { default: model },
    )
      .overrideProvider(STORAGE_MODULE_OPTIONS)
      .useValue({ default: 'receipts', disks: { receipts: disk } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    proxySecret = app.get(ConfigService).getOrThrow<string>('PROXY_SECRET');
    db = app.get<Db>(getDrizzleToken());
    await db.delete(users).where(inArray(users.email, [EMAIL_A, EMAIL_B]));
    const passwordHash = await new PasswordHasher().hash(PASSWORD);

    for (const [who, email] of [
      ['a', EMAIL_A],
      ['b', EMAIL_B],
    ] as const) {
      const [row] = await db
        .insert(users)
        .values({ email, passwordHash })
        .returning({ id: users.id });
      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .set('x-proxy-secret', proxySecret)
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      user[who] = {
        id: row.id,
        cookie: cookies.map((c) => c.split(';')[0]).join('; '),
      };
    }
  });

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [EMAIL_A, EMAIL_B]));
    await app.close();
  });

  let storeId: string;
  let receiptId: string;
  let lecheItem: string;
  let panItem: string;
  let lecheProductId: string;
  let panProductId: string;

  describe('factura leída por la IA', () => {
    beforeAll(async () => {
      const body = await upload('a', extraction(), {
        storeName: 'Carulla Fase3',
        storeType: 'cadena',
      });
      storeId = body.receipt.storeId;
      receiptId = body.receipt.id;
    });

    it('GET /receipts/:id -> tienda, fotos e ítems en el orden de la factura', async () => {
      const res = await api('a').get(`/receipts/${receiptId}`).expect(200);
      expect(res.body.receipt).toMatchObject({ status: 'draft', total: 12500 });
      expect(res.body.receipt.aiRaw).toBeUndefined();
      expect(res.body.store).toMatchObject({ id: storeId, type: 'cadena' });
      expect(res.body.images).toHaveLength(1);
      expect(
        res.body.items.map((i: { rawDescription: string }) => i.rawDescription),
      ).toEqual(['LECHE ENTERA 1100ML', 'PAN TAJADO']);
      expect(res.body.items[0]).toMatchObject({
        position: 1,
        confirmed: false,
        product: null,
        newProduct: { name: 'Leche entera' },
      });
      expect(res.body.items[1]).toMatchObject({
        product: null,
        newProduct: null,
      });
      [lecheItem, panItem] = res.body.items.map((i: { id: string }) => i.id);
    });

    it('PATCH /receipts/:id solo cambia los campos editables', async () => {
      const res = await api('a')
        .patch(`/receipts/${receiptId}`)
        .send({ total: 12500, status: 'confirmed', cufe: 'inyectado' })
        .expect(200);
      expect(res.body).toMatchObject({ status: 'draft', cufe: null });
    });

    it('PATCH /receipts/:id con fecha futura o sin campos -> 400', async () => {
      await api('a')
        .patch(`/receipts/${receiptId}`)
        .send({ purchasedAt: '2999-01-01' })
        .expect(400);
      await api('a')
        .patch(`/receipts/${receiptId}`)
        .send({ status: 'confirmed' })
        .expect(400);
    });

    it('confirmar con ítems pendientes -> 422', async () => {
      const res = await api('a')
        .post(`/receipts/${receiptId}/confirm`)
        .expect(422);
      expect(res.body.message).toContain('2 productos por confirmar');
    });

    it('confirmar con un ítem sin producto -> 422', async () => {
      for (const id of [lecheItem, panItem]) {
        await api('a')
          .patch(`/receipts/${receiptId}/items/${id}`)
          .send({ confirmed: true })
          .expect(200);
      }
      const res = await api('a')
        .post(`/receipts/${receiptId}/confirm`)
        .expect(422);
      expect(res.body.message).toContain('1 productos no tienen');
    });

    it('PATCH de ítem: producto inexistente -> 404, productId y product a la vez -> 400', async () => {
      const path = `/receipts/${receiptId}/items/${panItem}`;
      await api('a')
        .patch(path)
        .send({ productId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);
      await api('a')
        .patch(path)
        .send({
          productId: '00000000-0000-4000-8000-000000000000',
          product: newPan,
        })
        .expect(400);
    });

    it('PATCH de ítem recalcula line_total y asigna un producto nuevo', async () => {
      const path = `/receipts/${receiptId}/items/${panItem}`;
      const res = await api('a')
        .patch(path)
        .send({ quantity: 2, discount: 500, product: newPan, lineTotal: 1 })
        .expect(200);
      expect(res.body).toMatchObject({
        quantity: '2.000',
        lineTotal: 4500,
        newProduct: { name: 'Pan tajado' },
      });
      await api('a').patch(path).send({ quantity: 1, discount: 0 }).expect(200);
    });

    it('agregar un ítem a mano en una factura de la IA -> 409', async () => {
      await api('a')
        .post(`/receipts/${receiptId}/items`)
        .send({
          description: 'Arroz',
          quantity: 1,
          unit: 'und',
          unitPrice: 3000,
          product: newPan,
        })
        .expect(409);
    });

    it('POST /receipts/:id/manual en una factura legible -> 409', async () => {
      await api('a').post(`/receipts/${receiptId}/manual`).expect(409);
    });

    it('confirmar crea los productos y calcula el precio por unidad base', async () => {
      const res = await api('a')
        .post(`/receipts/${receiptId}/confirm`)
        .expect(200);
      expect(res.body.receipt.status).toBe('confirmed');
      const [l, p] = res.body.items;
      expect(l).toMatchObject({
        newProduct: null,
        unitPriceBase: '4.5455',
        product: { name: 'Leche entera', baseUnit: 'ml' },
      });
      expect(p).toMatchObject({
        unitPriceBase: '2500.0000',
        product: { name: 'Pan tajado' },
      });
      lecheProductId = l.productId;
      panProductId = p.productId;
    });

    it('una factura confirmada no se edita ni se borra -> 409', async () => {
      await api('a')
        .patch(`/receipts/${receiptId}`)
        .send({ total: 1 })
        .expect(409);
      await api('a')
        .patch(`/receipts/${receiptId}/items/${lecheItem}`)
        .send({ confirmed: false })
        .expect(409);
      await api('a').delete(`/receipts/${receiptId}`).expect(409);
      await api('a').post(`/receipts/${receiptId}/confirm`).expect(409);
    });

    it('reopen vuelve a draft y desmarca todos los ítems', async () => {
      const res = await api('a')
        .post(`/receipts/${receiptId}/reopen`)
        .expect(200);
      expect(res.body.receipt.status).toBe('draft');
      expect(
        res.body.items.map((i: { confirmed: boolean }) => i.confirmed),
      ).toEqual([false, false]);
      await api('a').post(`/receipts/${receiptId}/reopen`).expect(409);
      await api('a').post(`/receipts/${receiptId}/confirm`).expect(422);

      for (const id of [lecheItem, panItem]) {
        await api('a')
          .patch(`/receipts/${receiptId}/items/${id}`)
          .send({ confirmed: true })
          .expect(200);
      }
      await api('a').post(`/receipts/${receiptId}/confirm`).expect(200);
    });

    it('un producto sugerido con el mismo nombre reutiliza el del catálogo', async () => {
      const item = {
        ...leche,
        suggestedProduct: { ...leche.suggestedProduct, name: 'LECHE ENTERA' },
      };
      const body = await upload(
        'a',
        extraction({ items: [item], total: 10000, purchasedAt: '2026-02-01' }),
        { storeId },
      );
      await api('a')
        .patch(`/receipts/${body.receipt.id}/items/${body.items[0].id}`)
        .send({ confirmed: true })
        .expect(200);
      const res = await api('a')
        .post(`/receipts/${body.receipt.id}/confirm`)
        .expect(200);
      expect(res.body.items[0].productId).toBe(lecheProductId);
      const products = await api('a').get('/products?q=leche').expect(200);
      expect(products.body).toHaveLength(1);
    });
  });

  describe('registro manual (solo si la foto no se pudo leer)', () => {
    let manualId: string;
    let carneItem: string;

    beforeAll(async () => {
      manualId = (await upload('a', unreadable(), { storeId })).receipt.id;
    });

    it('editar o confirmar una factura ilegible -> 409', async () => {
      await api('a')
        .patch(`/receipts/${manualId}`)
        .send({ total: 1000 })
        .expect(409);
      await api('a').post(`/receipts/${manualId}/confirm`).expect(409);
    });

    it('POST /receipts/:id/manual -> draft con entry_mode manual', async () => {
      const res = await api('a')
        .post(`/receipts/${manualId}/manual`)
        .expect(200);
      expect(res.body).toMatchObject({ status: 'draft', entryMode: 'manual' });
      await api('a').post(`/receipts/${manualId}/manual`).expect(409);
    });

    it('confirmar sin fecha, total ni ítems -> 422', async () => {
      await api('a').post(`/receipts/${manualId}/confirm`).expect(422);
      await api('a')
        .patch(`/receipts/${manualId}`)
        .send({ purchasedAt: '2026-01-20', total: 27500 })
        .expect(200);
      const res = await api('a')
        .post(`/receipts/${manualId}/confirm`)
        .expect(422);
      expect(res.body.message).toContain('no tiene productos');
    });

    it('POST /receipts/:id/items valida el body', async () => {
      const path = `/receipts/${manualId}/items`;
      const base = { description: 'Arroz', quantity: 1, unit: 'und' };
      await api('a')
        .post(path)
        .send({ ...base, unitPrice: 3000 })
        .expect(400);
      await api('a')
        .post(path)
        .send({
          ...base,
          unitPrice: 3000,
          productId: panProductId,
          product: newPan,
        })
        .expect(400);
      await api('a')
        .post(path)
        .send({
          ...base,
          unitPrice: 3000,
          discount: 5000,
          productId: panProductId,
        })
        .expect(400);
    });

    it('POST /receipts/:id/items -> confirmado y line_total del servidor', async () => {
      const path = `/receipts/${manualId}/items`;
      const pan = await api('a')
        .post(path)
        .send({
          description: 'Pan',
          quantity: 1,
          unit: 'und',
          unitPrice: 2500,
          productId: panProductId,
          lineTotal: 1,
          confirmed: false,
        })
        .expect(201);
      expect(pan.body).toMatchObject({
        position: 1,
        lineTotal: 2500,
        confirmed: true,
        productId: panProductId,
      });

      const carne = await api('a')
        .post(path)
        .send({
          description: 'Carne molida',
          quantity: 1.25,
          unit: 'kg',
          unitPrice: 20000,
          // kg con un producto que se mide en und: el confirm lo rechaza.
          productId: panProductId,
        })
        .expect(201);
      expect(carne.body).toMatchObject({ position: 2, lineTotal: 25000 });
      carneItem = carne.body.id;
    });

    it('unidades incompatibles -> 422; al corregir el producto se confirma', async () => {
      const res = await api('a')
        .post(`/receipts/${manualId}/confirm`)
        .expect(422);
      expect(res.body.message).toContain('no es compatible');

      await api('a')
        .patch(`/receipts/${manualId}/items/${carneItem}`)
        .send({
          product: {
            name: 'Carne molida',
            category: 'Carnes',
            baseUnit: 'g',
            baseSize: 1,
          },
        })
        .expect(200);
      const ok = await api('a')
        .post(`/receipts/${manualId}/confirm`)
        .expect(200);
      expect(ok.body.receipt).toMatchObject({
        status: 'confirmed',
        entryMode: 'manual',
      });
      expect(ok.body.items[1]).toMatchObject({
        unitPriceBase: '20.0000',
        product: { name: 'Carne molida', category: 'Carnes' },
      });
    });
  });

  describe('listado y filtros', () => {
    it('lista con la tienda y paginación', async () => {
      const res = await api('a').get('/receipts?limit=1').expect(200);
      expect(res.body).toMatchObject({ page: 1, limit: 1 });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.total).toBeGreaterThanOrEqual(3);
      expect(res.body.data[0].store).toMatchObject({ id: storeId });
      expect(res.body.data[0].aiRaw).toBeUndefined();
    });

    it.each([
      ['storeType=cadena', true],
      ['storeType=plaza', false],
      ['q=carulla', true],
      ['q=pan%20tajado', true],
      ['q=%25', false],
      ['q=_', false],
      ['category=l%C3%A1cteos', true],
      ['category=ferreter%C3%ADa', false],
      ['from=2026-01-15&to=2026-01-15', true],
      ['from=2026-03-01', false],
    ])('%s', async (filter, found) => {
      const res = await api('a')
        .get(`/receipts?${filter}&storeId=${storeId}&limit=100`)
        .expect(200);
      const ids = res.body.data.map((r: { id: string }) => r.id);
      expect(ids.includes(receiptId)).toBe(found);
    });

    it('filtro inválido -> 400', async () => {
      await api('a').get('/receipts?from=ayer').expect(400);
      await api('a').get('/receipts?limit=500').expect(400);
    });
  });

  describe('borrar', () => {
    it('DELETE de un draft o unreadable -> 204 y borra las fotos', async () => {
      const draft = await upload(
        'a',
        extraction({ items: [pan], total: 2500 }),
        {
          storeId,
        },
      );
      const broken = await upload('a', unreadable(), { storeId });
      const keysBefore = disk.keys().length;

      for (const id of [draft.receipt.id, broken.receipt.id]) {
        await api('a').delete(`/receipts/${id}`).expect(204);
        await api('a').get(`/receipts/${id}`).expect(404);
      }
      expect(disk.keys()).toHaveLength(keysBefore - 2);
    });
  });

  describe('productos', () => {
    it('GET /products?q= busca y escapa comodines', async () => {
      const res = await api('a').get('/products?q=PAN').expect(200);
      expect(res.body.map((p: { id: string }) => p.id)).toEqual([panProductId]);
      await api('a')
        .get('/products?q=%25')
        .expect(200)
        .expect((r) => expect(r.body).toEqual([]));
    });

    it('PATCH /products/:id actualiza; nombre repetido -> 409', async () => {
      const res = await api('a')
        .patch(`/products/${panProductId}`)
        .send({ category: 'Panadería y galletas', baseSize: 12, userId: 'x' })
        .expect(200);
      expect(res.body).toMatchObject({
        category: 'Panadería y galletas',
        baseSize: '12.000',
      });
      await api('a')
        .patch(`/products/${panProductId}`)
        .send({ name: 'leche entera' })
        .expect(409);
    });
  });

  describe('aislamiento: B no ve ni toca nada de A', () => {
    it('los listados de B no traen datos de A', async () => {
      const receipts = await api('b').get('/receipts').expect(200);
      expect(receipts.body).toMatchObject({ data: [], total: 0 });
      await api('b')
        .get('/products')
        .expect(200)
        .expect((r) => expect(r.body).toEqual([]));
      await api('b')
        .get('/stores')
        .expect(200)
        .expect((r) => expect(r.body).toEqual([]));
    });

    it('leer, editar o borrar recursos de A -> 404', async () => {
      const b = api('b');
      const item = { description: 'x', quantity: 1, unit: 'und', unitPrice: 1 };
      await b.get(`/receipts/${receiptId}`).expect(404);
      await b.get(`/receipts/${receiptId}/images`).expect(404);
      await b.patch(`/receipts/${receiptId}`).send({ total: 1 }).expect(404);
      await b.delete(`/receipts/${receiptId}`).expect(404);
      await b.post(`/receipts/${receiptId}/reopen`).expect(404);
      await b.post(`/receipts/${receiptId}/confirm`).expect(404);
      await b.post(`/receipts/${receiptId}/manual`).expect(404);
      await b
        .post(`/receipts/${receiptId}/items`)
        .send({ ...item, productId: panProductId })
        .expect(404);
      await b
        .patch(`/receipts/${receiptId}/items/${lecheItem}`)
        .send({ confirmed: true })
        .expect(404);
      await b.patch(`/stores/${storeId}`).send({ name: 'x' }).expect(404);
      await b
        .patch(`/products/${panProductId}`)
        .send({ name: 'x' })
        .expect(404);
    });

    it('B no puede asociar un producto de A a su propia factura -> 404', async () => {
      const body = await upload('b', extraction(), {
        storeName: 'Tienda de B',
        storeType: 'barrio',
      });
      await api('b')
        .patch(`/receipts/${body.receipt.id}/items/${body.items[0].id}`)
        .send({ productId: lecheProductId })
        .expect(404);
      await api('b')
        .patch(`/receipts/${body.receipt.id}/items/${lecheItem}`)
        .send({ confirmed: true })
        .expect(404);
    });
  });
});

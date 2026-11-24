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
const EMAIL_A = 'phase4-a@example.com';
const EMAIL_B = 'phase4-b@example.com';

let seq = 0;
const jpeg = () =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`jpeg-${Date.now()}-${seq++}`),
  ]);

const products = {
  leche: {
    name: 'Leche entera',
    category: 'Lácteos',
    baseUnit: 'ml',
    baseSize: 1100,
  },
  arroz: { name: 'Arroz', category: 'Granos', baseUnit: 'g', baseSize: 500 },
  huevos: { name: 'Huevos', category: 'Huevos', baseUnit: 'und', baseSize: 30 },
};

const line = (
  product: keyof typeof products,
  quantity: number,
  unitPrice: number,
) => ({
  rawDescription: products[product].name.toUpperCase(),
  quantity,
  unit: 'und',
  unitPrice,
  discount: 0,
  lineTotal: quantity * unitPrice,
  matchedProductId: null,
  suggestedProduct: products[product],
});

const extraction = (purchasedAt: string, items: ReturnType<typeof line>[]) => ({
  object: {
    readable: true,
    unreadableReason: null,
    purchasedAt,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
    nit: null,
    cufe: null,
    items,
  },
});

describe('Comparación y reportes (e2e)', () => {
  let app: INestApplication<App>;
  let db: Db;
  let proxySecret: string;
  const model = new FakeModel();
  const disk = new InMemoryDisk();
  const user = { a: { cookie: '' }, b: { cookie: '' } };

  const api = (who: keyof typeof user) => {
    const server = app.getHttpServer();
    const auth = <T extends request.Test>(req: T) =>
      req.set('x-proxy-secret', proxySecret).set('Cookie', user[who].cookie);
    return {
      get: (path: string) => auth(request(server).get(path)),
      patch: (path: string) => auth(request(server).patch(path)),
      post: (path: string) => auth(request(server).post(path)),
    };
  };

  const upload = async (
    reply: ReturnType<typeof extraction>,
    fields: Record<string, string>,
  ) => {
    model.reply(reply);
    const req = api('a').post('/receipts');
    for (const [name, value] of Object.entries(fields)) req.field(name, value);
    const res = await req.attach('images', jpeg(), 'foto.jpg').expect(201);
    return res.body as {
      receipt: { id: string; storeId: string };
      items: { id: string }[];
    };
  };

  const confirmed = async (
    reply: ReturnType<typeof extraction>,
    fields: Record<string, string>,
  ) => {
    const { receipt, items } = await upload(reply, fields);
    for (const item of items) {
      await api('a')
        .patch(`/receipts/${receipt.id}/items/${item.id}`)
        .send({ confirmed: true })
        .expect(200);
    }
    const res = await api('a')
      .post(`/receipts/${receipt.id}/confirm`)
      .expect(200);
    return {
      id: receipt.id,
      storeId: receipt.storeId,
      products: res.body.items as {
        productId: string;
        product: { name: string };
      }[],
    };
  };

  let exito: string;
  let plaza: string;
  let enero: string;
  let febrero: string;
  let marzo: string;
  let borrador: string;
  let lecheId: string;

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
      await db.insert(users).values({ email, passwordHash });
      const res = await request(app.getHttpServer())
        .post('/auth/sign-in')
        .set('x-proxy-secret', proxySecret)
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookies = res.headers['set-cookie'] as unknown as string[];
      user[who].cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    }

    // Leche: 4,5455 $/ml → 4,5909 (+1 %, igual) → 5 (+8,9 %, subió). Arroz: 6 $/g → 5 (bajó).
    const r1 = await confirmed(
      extraction('2026-01-10', [
        line('leche', 2, 5000),
        line('arroz', 1, 3000),
      ]),
      { storeName: 'Éxito Fase4', storeType: 'cadena' },
    );
    exito = r1.storeId;
    enero = r1.id;
    lecheId = r1.products.find(
      (p) => p.product.name === 'Leche entera',
    )!.productId;

    const r2 = await confirmed(
      extraction('2026-02-10', [
        line('leche', 1, 5050),
        line('arroz', 1, 2500),
        line('huevos', 1, 15000),
      ]),
      { storeName: 'Plaza Fase4', storeType: 'plaza' },
    );
    plaza = r2.storeId;
    febrero = r2.id;

    marzo = (
      await confirmed(extraction('2026-03-10', [line('leche', 1, 5500)]), {
        storeId: exito,
      })
    ).id;

    // Un borrador más barato no debe contar en ningún reporte.
    borrador = (
      await upload(extraction('2026-04-01', [line('leche', 1, 1000)]), {
        storeId: plaza,
      })
    ).receipt.id;
    // Arma 4 facturas contra Neon real: pasa de los 10 s por defecto.
  }, 60_000);

  afterAll(async () => {
    await db.delete(users).where(inArray(users.email, [EMAIL_A, EMAIL_B]));
    await app.close();
  });

  describe('GET /receipts/:id/comparison', () => {
    it('primera compra: todo es nuevo', async () => {
      const res = await api('a')
        .get(`/receipts/${enero}/comparison`)
        .expect(200);
      expect(res.body.summary).toEqual({
        subio: 0,
        bajo: 0,
        igual: 0,
        nuevo: 2,
      });
      expect(res.body.items[0]).toMatchObject({
        previous: null,
        changePct: null,
      });
    });

    it('vs la compra anterior de cada producto, con umbral de ±2 %', async () => {
      const res = await api('a')
        .get(`/receipts/${febrero}/comparison`)
        .expect(200);
      expect(res.body).toMatchObject({
        purchasedAt: '2026-02-10',
        summary: { subio: 0, bajo: 1, igual: 1, nuevo: 1 },
      });
      expect(res.body.items).toMatchObject([
        {
          product: { name: 'Arroz' },
          unitPriceBase: 5,
          trend: 'bajo',
          changePct: -16.7,
          previous: {
            receiptId: enero,
            purchasedAt: '2026-01-10',
            unitPriceBase: 6,
            store: { id: exito, type: 'cadena' },
          },
        },
        { product: { name: 'Huevos' }, trend: 'nuevo', previous: null },
        { product: { name: 'Leche entera' }, trend: 'igual', changePct: 1 },
      ]);
    });

    it('la compra anterior es la más reciente, no la primera', async () => {
      const res = await api('a')
        .get(`/receipts/${marzo}/comparison`)
        .expect(200);
      expect(res.body.items).toMatchObject([
        {
          product: { name: 'Leche entera' },
          unitPriceBase: 5,
          trend: 'subio',
          changePct: 8.9,
          previous: { receiptId: febrero, store: { id: plaza } },
        },
      ]);
    });

    it('factura sin confirmar -> 409; id inválido -> 400', async () => {
      await api('a').get(`/receipts/${borrador}/comparison`).expect(409);
      await api('a').get('/receipts/abc/comparison').expect(400);
    });
  });

  describe('GET /products/:id/price-history', () => {
    it('compras confirmadas en orden, con la tendencia vs la anterior', async () => {
      const res = await api('a')
        .get(`/products/${lecheId}/price-history`)
        .expect(200);
      expect(res.body.product).toMatchObject({ name: 'Leche entera' });
      expect(res.body.data).toMatchObject([
        { receiptId: enero, unitPriceBase: 4.5455, trend: 'nuevo' },
        { receiptId: febrero, unitPriceBase: 4.5909, trend: 'igual' },
        { receiptId: marzo, unitPriceBase: 5, trend: 'subio' },
      ]);
    });

    it('filtra por tipo de tienda y fechas', async () => {
      const plazaOnly = await api('a')
        .get(`/products/${lecheId}/price-history?storeType=plaza`)
        .expect(200);
      expect(plazaOnly.body.data).toMatchObject([
        { receiptId: febrero, trend: 'nuevo' },
      ]);
      const fromMarch = await api('a')
        .get(`/products/${lecheId}/price-history?from=2026-03-01`)
        .expect(200);
      expect(fromMarch.body.data).toHaveLength(1);
    });
  });

  describe('GET /insights/cheapest', () => {
    it('gana el último precio más bajo de cada tienda, también por tipo', async () => {
      const res = await api('a').get('/insights/cheapest').expect(200);
      expect(res.body).toMatchObject([
        {
          product: { name: 'Arroz' },
          cheapest: { store: { id: plaza }, unitPriceBase: 5 },
          byStoreType: [
            { store: { type: 'plaza' }, unitPriceBase: 5 },
            { store: { type: 'cadena' }, unitPriceBase: 6 },
          ],
        },
        {
          product: { name: 'Huevos' },
          cheapest: { store: { id: plaza }, unitPriceBase: 500 },
        },
        {
          product: { name: 'Leche entera' },
          // En el Éxito cuenta marzo (5), no enero (4,5455), y el borrador no cuenta.
          cheapest: { store: { id: plaza }, unitPriceBase: 4.5909 },
          byStoreType: [
            { store: { type: 'plaza' } },
            {
              store: { id: exito },
              unitPriceBase: 5,
              purchasedAt: '2026-03-10',
            },
          ],
        },
      ]);
    });

    it.each([
      ['storeType=cadena', ['Arroz', 'Leche entera']],
      ['q=leche', ['Leche entera']],
      ['q=plaza', ['Arroz', 'Huevos', 'Leche entera']],
      ['category=GRANOS', ['Arroz']],
      ['from=2026-03-01', ['Leche entera']],
      ['q=%25', []],
    ])('%s', async (filter, names) => {
      const res = await api('a')
        .get(`/insights/cheapest?${filter}`)
        .expect(200);
      expect(
        res.body.map((p: { product: { name: string } }) => p.product.name),
      ).toEqual(names);
    });
  });

  describe('GET /insights/spending', () => {
    it('por mes (por defecto), solo facturas confirmadas', async () => {
      const res = await api('a').get('/insights/spending').expect(200);
      expect(res.body).toEqual({
        groupBy: 'month',
        total: 41050,
        data: [
          { key: '2026-01', total: 13000, receipts: 1 },
          { key: '2026-02', total: 22550, receipts: 1 },
          { key: '2026-03', total: 5500, receipts: 1 },
        ],
      });
    });

    it('por tipo de tienda', async () => {
      const res = await api('a')
        .get('/insights/spending?groupBy=storeType')
        .expect(200);
      expect(res.body.data).toEqual([
        { key: 'cadena', total: 18500, receipts: 2 },
        { key: 'plaza', total: 22550, receipts: 1 },
      ]);
    });

    it('con categoría suma solo sus líneas', async () => {
      const res = await api('a')
        .get('/insights/spending?category=l%C3%A1cteos&from=2026-02-01')
        .expect(200);
      expect(res.body).toMatchObject({
        total: 10550,
        data: [
          { key: '2026-02', total: 5050, receipts: 1 },
          { key: '2026-03', total: 5500, receipts: 1 },
        ],
      });
    });

    it('groupBy inválido -> 400', async () => {
      await api('a').get('/insights/spending?groupBy=year').expect(400);
    });
  });

  describe('aislamiento: B no ve nada de A', () => {
    it('comparación e historial de A -> 404', async () => {
      await api('b').get(`/receipts/${febrero}/comparison`).expect(404);
      await api('b').get(`/products/${lecheId}/price-history`).expect(404);
    });

    it('los reportes de B están vacíos', async () => {
      await api('b')
        .get('/insights/cheapest')
        .expect(200)
        .expect((r) => expect(r.body).toEqual([]));
      await api('b')
        .get('/insights/spending')
        .expect(200)
        .expect((r) =>
          expect(r.body).toEqual({ groupBy: 'month', total: 0, data: [] }),
        );
    });
  });
});

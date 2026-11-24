import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getDrizzleToken } from '@nestjs/drizzle';
import { PasswordHasher } from '@nestjs/authentication';
import { FakeModel, overrideModels, providerError } from '@nestjs/ai/testing';
import { InMemoryDisk, STORAGE_MODULE_OPTIONS } from '@nestjs/storage';
import { eq, inArray } from 'drizzle-orm';
import type { NeonDatabase } from 'drizzle-orm/neon-serverless';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { receiptItems, stores, users } from '../src/db/schema.js';
import type * as schema from '../src/db/schema.js';

const PASSWORD = 'ValidPassword123';
const EMAIL_A = 'phase2-a@example.com';
const EMAIL_B = 'phase2-b@example.com';

let seq = 0;
const jpeg = () =>
  Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    Buffer.from(`jpeg-${Date.now()}-${seq++}`),
  ]);
const png = () =>
  Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    Buffer.from(`png-${Date.now()}-${seq++}`),
  ]);

const extraction = (overrides: Record<string, unknown> = {}) => ({
  object: {
    readable: true,
    unreadableReason: null,
    purchasedAt: '2026-01-15',
    total: 12500,
    nit: null,
    cufe: null,
    items: [
      {
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
      },
      {
        rawDescription: 'PAN TAJADO',
        quantity: 1,
        unit: 'und',
        unitPrice: 2500,
        discount: 0,
        lineTotal: 2500,
        matchedProductId: '00000000-0000-4000-8000-000000000000',
        suggestedProduct: null,
      },
    ],
    ...overrides,
  },
});

const unreadable = (reason: string) =>
  extraction({
    readable: false,
    unreadableReason: reason,
    purchasedAt: null,
    total: null,
    items: [],
  });

describe('Receipts (e2e)', () => {
  let app: INestApplication<App>;
  let db: NeonDatabase<typeof schema>;
  let proxySecret: string;
  const model = new FakeModel();
  const disk = new InMemoryDisk({
    signedUrls: {
      baseUrl: 'https://files.example.com',
      keys: ['test-signing-key-0123456789abcdef'],
    },
  });
  const user = { a: { id: '', cookie: '' }, b: { id: '', cookie: '' } };

  const api = (who: keyof typeof user) => {
    const server = app.getHttpServer();
    const auth = <T extends request.Test>(req: T) =>
      req.set('x-proxy-secret', proxySecret).set('Cookie', user[who].cookie);
    return {
      get: (path: string) => auth(request(server).get(path)),
      patch: (path: string) => auth(request(server).patch(path)),
      post: (path: string) => auth(request(server).post(path)),
      put: (path: string) => auth(request(server).put(path)),
    };
  };

  const upload = (
    req: request.Test,
    files: Buffer[],
    fields: Record<string, string> = {},
  ) => {
    for (const [name, value] of Object.entries(fields)) req.field(name, value);
    files.forEach((file, i) => req.attach('images', file, `foto-${i}.jpg`));
    return req;
  };

  const userKeys = (who: keyof typeof user) =>
    disk
      .keys()
      .filter((key) => key.startsWith(`users/${user[who].id}/receipts/`));

  beforeAll(async () => {
    const moduleRef = await overrideModels(
      Test.createTestingModule({ imports: [AppModule] }),
      {
        default: model,
      },
    )
      .overrideProvider(STORAGE_MODULE_OPTIONS)
      .useValue({ default: 'receipts', disks: { receipts: disk } })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();

    proxySecret = app.get(ConfigService).getOrThrow<string>('PROXY_SECRET');
    db = app.get<NeonDatabase<typeof schema>>(getDrizzleToken());
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
  let draftId: string;
  let unreadableId: string;

  it('1 foto legible -> draft con ítems, foto en el bucket y tienda creada', async () => {
    model.reply(extraction({ nit: '900123456-1' }));
    const res = await upload(api('a').post('/receipts'), [jpeg()], {
      storeName: 'Éxito Test',
      storeType: 'cadena',
    }).expect(201);

    expect(res.body.receipt).toMatchObject({
      status: 'draft',
      entryMode: 'ai',
      total: 12500,
      purchasedAt: '2026-01-15',
    });
    expect(res.body.receipt.aiRaw).toBeUndefined();
    expect(res.body.warning).toBeUndefined();
    expect(res.body.images).toHaveLength(1);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0]).toMatchObject({
      confirmed: false,
      quantity: '2.000',
      productId: null,
    });
    expect(res.body.items[0].newProduct.name).toBe('Leche entera');
    // Un id que no está en el catálogo del usuario no se guarda.
    expect(res.body.items[1].productId).toBeNull();
    expect(userKeys('a')).toHaveLength(1);

    storeId = res.body.receipt.storeId;
    draftId = res.body.receipt.id;
    const [store] = await db
      .select()
      .from(stores)
      .where(eq(stores.id, storeId));
    expect(store).toMatchObject({
      name: 'Éxito Test',
      type: 'cadena',
      nit: '900123456-1',
    });
  });

  it('la misma foto otra vez -> 409 sin llamar a la IA', async () => {
    model.reply(extraction());
    const file = jpeg();
    await upload(api('a').post('/receipts'), [file], { storeId }).expect(201);
    const calls = model.calls.length;
    await upload(api('a').post('/receipts'), [file], { storeId }).expect(409);
    expect(model.calls.length).toBe(calls);
  });

  it('2 fotos -> una sola llamada con las dos imágenes, y aviso si el total no cuadra', async () => {
    model.reply(extraction({ total: 99000 }));
    const res = await upload(api('a').post('/receipts'), [jpeg(), png()], {
      storeId,
    }).expect(201);

    expect(
      res.body.images.map((img: { position: number }) => img.position),
    ).toEqual([1, 2]);
    expect(res.body.warning).toBeDefined();
    const parts = model.lastCall!.options.prompt.flatMap(
      (message): { type: string }[] =>
        Array.isArray(message.content) ? message.content : [],
    );
    expect(parts.filter((part) => part.type === 'file')).toHaveLength(2);
  });

  it('3 fotos -> 400', async () => {
    const calls = model.calls.length;
    await upload(api('a').post('/receipts'), [jpeg(), jpeg(), jpeg()], {
      storeId,
    }).expect(400);
    expect(model.calls.length).toBe(calls);
  });

  it('sin fotos -> 400', async () => {
    await api('a').post('/receipts').field('storeId', storeId).expect(400);
  });

  it('archivo que no es imagen -> 400', async () => {
    await upload(
      api('a').post('/receipts'),
      [Buffer.from('%PDF-1.7 esto no es una imagen')],
      { storeId },
    ).expect(400);
  });

  it('sin tienda -> 400', async () => {
    await upload(api('a').post('/receipts'), [jpeg()]).expect(400);
  });

  it('foto ilegible -> unreadable con su motivo', async () => {
    model.reply(unreadable('oscura'));
    const res = await upload(api('a').post('/receipts'), [jpeg()], {
      storeId,
    }).expect(201);

    expect(res.body.receipt).toMatchObject({
      status: 'unreadable',
      unreadableReason: 'oscura',
      total: null,
    });
    expect(res.body.items).toEqual([]);
    expect(res.body.message).toContain('iluminación');
    unreadableId = res.body.receipt.id;
  });

  it('legible según la IA pero sin ítems -> unreadable', async () => {
    model.reply(extraction({ items: [] }));
    const res = await upload(api('a').post('/receipts'), [jpeg()], {
      storeId,
    }).expect(201);
    expect(res.body.receipt).toMatchObject({
      status: 'unreadable',
      unreadableReason: 'no_es_factura',
    });
  });

  it('GET /receipts/:id/images -> URLs firmadas', async () => {
    const res = await api('a')
      .get(`/receipts/${unreadableId}/images`)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].url).toMatch(/^https:\/\/files\.example\.com/);
  });

  it('PUT /receipts/:id/images reemplaza las fotos y pasa a draft', async () => {
    const before = await api('a')
      .get(`/receipts/${unreadableId}/images`)
      .expect(200);
    const keysBefore = userKeys('a');

    model.reply(extraction());
    const res = await upload(api('a').put(`/receipts/${unreadableId}/images`), [
      jpeg(),
      jpeg(),
    ]).expect(200);

    expect(res.body.receipt).toMatchObject({
      id: unreadableId,
      status: 'draft',
      unreadableReason: null,
    });
    expect(res.body.items).toHaveLength(2);
    const after = await api('a')
      .get(`/receipts/${unreadableId}/images`)
      .expect(200);
    expect(after.body).toHaveLength(2);
    expect(after.body[0].id).not.toBe(before.body[0].id);
    // Se borra 1 foto vieja y se suben 2 nuevas.
    expect(userKeys('a')).toHaveLength(keysBefore.length + 1);
  });

  it('PUT /receipts/:id/images en una factura que no es unreadable -> 409', async () => {
    await upload(api('a').put(`/receipts/${draftId}/images`), [jpeg()]).expect(
      409,
    );
  });

  it('salida inválida de la IA -> 502, borra las fotos y se puede reintentar', async () => {
    const keysBefore = userKeys('a').length;
    const file = jpeg();
    const items = [{ ...extraction().object.items[0], quantity: -1 }];

    model.reply(extraction({ items }));
    await upload(api('a').post('/receipts'), [file], { storeId }).expect(502);
    expect(userKeys('a')).toHaveLength(keysBefore);

    model.reply(extraction());
    await upload(api('a').post('/receipts'), [file], { storeId }).expect(201);
  });

  it('fecha futura en la salida de la IA -> 502', async () => {
    model.reply(extraction({ purchasedAt: '2999-01-01' }));
    await upload(api('a').post('/receipts'), [jpeg()], { storeId }).expect(502);
  });

  it('error del proveedor de IA -> 502 y borra las fotos', async () => {
    const keysBefore = userKeys('a').length;
    model.reply(providerError(400));
    await upload(api('a').post('/receipts'), [jpeg()], { storeId }).expect(502);
    expect(userKeys('a')).toHaveLength(keysBefore);
  });

  it('CUFE ya registrado -> 409 y borra las fotos', async () => {
    const cufe = `cufe-${Date.now()}`;
    model.reply(extraction({ cufe }));
    await upload(api('a').post('/receipts'), [jpeg()], { storeId }).expect(201);

    const keysBefore = userKeys('a').length;
    model.reply(extraction({ cufe }));
    await upload(api('a').post('/receipts'), [jpeg()], { storeId }).expect(409);
    expect(userKeys('a')).toHaveLength(keysBefore);
  });

  it('GET /stores?q= filtra y escapa comodines', async () => {
    const found = await api('a').get('/stores?q=éxito').expect(200);
    expect(found.body.map((s: { id: string }) => s.id)).toContain(storeId);
    const wildcard = await api('a').get('/stores?q=%25').expect(200);
    expect(wildcard.body).toEqual([]);
  });

  it('PATCH /stores/:id actualiza; NIT vacío -> null; id inválido -> 400', async () => {
    const res = await api('a')
      .patch(`/stores/${storeId}`)
      .send({ type: 'barrio', nit: '' })
      .expect(200);
    expect(res.body).toMatchObject({ type: 'barrio', nit: null });
    await api('a')
      .patch('/stores/no-es-uuid')
      .send({ type: 'plaza' })
      .expect(400);
  });

  describe('aislamiento: B no ve nada de A', () => {
    let unreadableOfA: string;

    beforeAll(async () => {
      model.reply(unreadable('borrosa'));
      const res = await upload(api('a').post('/receipts'), [jpeg()], {
        storeId,
      }).expect(201);
      unreadableOfA = res.body.receipt.id;
    });

    it('GET /stores no lista tiendas de A', async () => {
      const res = await api('b').get('/stores').expect(200);
      expect(res.body).toEqual([]);
    });

    it('PATCH /stores/:id de A -> 404', async () => {
      await api('b')
        .patch(`/stores/${storeId}`)
        .send({ name: 'Hackeada' })
        .expect(404);
    });

    it('POST /receipts con la tienda de A -> 404', async () => {
      await upload(api('b').post('/receipts'), [jpeg()], { storeId }).expect(
        404,
      );
    });

    it('GET /receipts/:id/images de A -> 404', async () => {
      await api('b').get(`/receipts/${draftId}/images`).expect(404);
    });

    it('PUT /receipts/:id/images de A -> 404', async () => {
      await upload(api('b').put(`/receipts/${unreadableOfA}/images`), [
        jpeg(),
      ]).expect(404);
    });

    it('la misma foto que subió A sí la puede subir B', async () => {
      const file = jpeg();
      model.reply(extraction(), extraction());
      await upload(api('a').post('/receipts'), [file], { storeId }).expect(201);
      const res = await upload(api('b').post('/receipts'), [file], {
        storeName: 'Tienda de B',
        storeType: 'barrio',
      }).expect(201);
      expect(userKeys('b')).toHaveLength(1);

      const items = await db
        .select()
        .from(receiptItems)
        .where(eq(receiptItems.receiptId, res.body.receipt.id));
      expect(items).toHaveLength(2);
    });
  });
});

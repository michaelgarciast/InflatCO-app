# Regla: Flujo de Git para subir cambios

Aplica SIEMPRE que vayas a commitear, pushear o abrir un PR. Sigue estos pasos en orden y no te saltes ninguno.

## 1. Principios

- `main` siempre debe estar estable y desplegable. **Nunca** hagas commit ni push directo a `main`.
- Cada cambio vive en una rama corta, con un solo propósito.
- Commits pequeños, atómicos y con mensajes claros.
- Todo cambio entra a `main` mediante Pull Request, incluso en un proyecto personal.

## 2. Antes de empezar

```bash
git checkout main
git pull origin main
git status   # debe estar limpio
```

Si hay cambios sin commitear que no pertenecen a la tarea, avísame antes de continuar.

## 3. Nombres de ramas

Formato: `<tipo>/<descripcion-corta-en-kebab-case>`

| Tipo       | Uso                                         |
|------------|---------------------------------------------|
| `feat`     | Nueva funcionalidad                         |
| `fix`      | Corrección de un bug                        |
| `refactor` | Cambio interno sin alterar comportamiento   |
| `docs`     | Solo documentación                          |
| `test`     | Agregar o corregir pruebas                  |
| `chore`    | Mantenimiento, dependencias, configuración  |
| `ci`       | Pipelines y automatizaciones                |
| `perf`     | Mejoras de rendimiento                      |

Ejemplos: `feat/escaneo-de-recibos`, `fix/precio-duplicado-al-guardar`, `chore/actualizar-drizzle`.

## 4. Commits (Conventional Commits)

Formato:

```
<tipo>(<alcance opcional>): <descripción en imperativo, minúscula, sin punto final>

<cuerpo opcional: qué y por qué, no cómo>

<footer opcional: BREAKING CHANGE: ... / Closes #123>
```

Reglas:
- Primera línea de máximo 72 caracteres.
- Un commit = un cambio lógico. No mezcles features con refactors ni formateo.
- Usa los mismos tipos que en las ramas (`feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `perf`).
- Cambios que rompen compatibilidad: agrega `!` después del tipo (`feat!: ...`) y un footer `BREAKING CHANGE:`.
- Prohibido: mensajes como "fix", "cambios", "wip", "asdf", "update".
- Sin atribución a Devin ni `Co-Authored-By`. Autor único: `Michael Garcia <53796898+michaelgarciast@users.noreply.github.com>` (pásalo con `git -c user.name=... -c user.email=... commit`, sin tocar la config de git).

Ejemplos:
```
feat(recibos): agregar escaneo de recibos con gemini
fix(precios): evitar duplicados al guardar un recibo
refactor(storage): extraer subida de archivos a un servicio
chore(deps): actualizar drizzle-orm
```

## 5. Verificación antes de hacer push (NestJS + Bun)

Usa siempre Bun, nunca `npm`, `yarn` ni `pnpm`. Los hooks de Husky ya validan en cada commit (`pre-commit`: lint + tipos; `commit-msg`: commitlint) y CI corre lint, tipos, tests y build en cada PR. Antes de pushear solo falta:

1. `bun run test`
2. `bun run test:e2e` si el cambio toca la base de datos, storage o endpoints (usa la DB real de Neon del `.env`, por eso no corre en CI).
3. Revisar el diff: sin secretos, `.env`, `dist/`, `node_modules/`, `console.log` ni código comentado.

Usa `bun run test`, **no** `bun test`: este último ejecuta el test runner nativo de Bun en lugar de Vitest.

Dependencias: usa `bun add` / `bun add -d` / `bun remove`. Commitea siempre `bun.lock` junto con `package.json`, en un commit `chore(deps)` separado de la lógica. No agregues otros lockfiles (`package-lock.json`, `pnpm-lock.yaml`) al repositorio.

## 6. Mantener la rama actualizada

Como el merge es squash, no hace falta reescribir la rama. Actualízala solo si GitHub reporta conflictos o la rama se quedó atrás de un cambio relevante:

```bash
git fetch origin
git merge origin/main
```

Nunca `git push --force` a secas, y jamás force push a `main`.

## 7. Pull Request

Título con formato Conventional Commit, por ejemplo: `feat(recibos): agregar escaneo de recibos con gemini`.

Descripción con esta plantilla:

```markdown
## ¿Qué cambia?
<resumen breve>

## ¿Por qué?
<motivación o issue relacionado: Closes #N>

## ¿Cómo se probó?
<pasos o comandos>

## Checklist
- [ ] CI en verde
- [ ] e2e corridos (si aplica)
- [ ] Documentación actualizada (si aplica)
```

Reglas del PR:
- Pequeño y enfocado: idealmente menos de ~400 líneas cambiadas.
- Si el PR es muy grande, propón dividirlo antes de abrirlo.

## 8. Merge

- Usa **Squash and merge** para dejar un historial lineal, con un commit por PR que siga Conventional Commits.
- No hagas merge con CI fallando o pendiente.
- Elimina la rama remota y local después del merge, y sincroniza:

```bash
git checkout main
git pull origin main
git branch -d <rama>
```

## 9. Prohibiciones

- Push directo a `main`.
- `git push --force` sin `--with-lease`, o force push a `main`.
- Commits con secretos, `.env`, `node_modules`, builds o archivos del sistema.
- Mezclar cambios no relacionados en una misma rama o PR.
- Ignorar errores de lint, tipos o tests para "subir rápido".

## 10. Cómo debes reportarme

Antes de ejecutar `git push`, muéstrame:
1. El nombre de la rama.
2. La lista de commits (`git log --oneline origin/main..HEAD`).
3. El resultado de la verificación.

Espera mi confirmación antes de pushear o hacer merge.

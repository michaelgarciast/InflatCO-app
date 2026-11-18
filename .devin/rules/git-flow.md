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
| `hotfix`   | Corrección urgente sobre producción         |
| `refactor` | Cambio interno sin alterar comportamiento   |
| `docs`     | Solo documentación                          |
| `test`     | Agregar o corregir pruebas                  |
| `chore`    | Mantenimiento, dependencias, configuración  |
| `ci`       | Pipelines y automatizaciones                |
| `perf`     | Mejoras de rendimiento                      |

Ejemplos: `feat/login-con-google`, `fix/crash-al-abrir-rutina`, `chore/actualizar-expo`.

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

Ejemplos:
```
feat(auth): agregar inicio de sesión con Google
fix(rutinas): evitar crash cuando la lista de series está vacía
refactor(api): extraer cliente HTTP a un módulo independiente
chore(deps): actualizar expo a la última versión estable
```

## 5. Checklist antes de hacer push (NestJS + Bun)

Usa siempre Bun, nunca `npm`, `yarn` ni `pnpm`. Ejecuta en este orden y **no hagas push si algo falla**:

1. `bun run lint`
2. `bunx tsc --noEmit` (chequeo de tipos)
3. `bun run test` (unitarios)
4. `bun run test:e2e` (si existen pruebas e2e)
5. `bun run build`
6. `git diff --staged` (revisar el diff completo)
7. Verificar que no haya secretos, `.env`, `dist/`, `node_modules/`, `console.log` ni código comentado

Importante: usa `bun run test`, **no** `bun test`. Este último ejecuta el test runner nativo de Bun e ignora la configuración de Jest que trae Nest por defecto. Si algún script no existe en `package.json`, omítelo y avísame; no lo inventes.

Dependencias: usa `bun add` / `bun add -d` / `bun remove`. Commitea siempre el lockfile (`bun.lock`, o `bun.lockb` en versiones antiguas de Bun) junto con `package.json`, en un commit `chore(deps)` separado de la lógica. No agregues otros lockfiles (`package-lock.json`, `pnpm-lock.yaml`) al repositorio.

## 6. Mantener la rama actualizada

Antes de abrir el PR:

```bash
git fetch origin
git rebase origin/main
```

Si hay conflictos, resuélvelos con cuidado, vuelve a correr el checklist y solo entonces haz:

```bash
git push --force-with-lease
```

(Nunca `--force` a secas. Y jamás force push a `main`.)

## 7. Pull Request

Título con formato Conventional Commit, por ejemplo: `feat(auth): agregar inicio de sesión con Google`.

Descripción con esta plantilla:

```markdown
## ¿Qué cambia?
<resumen breve>

## ¿Por qué?
<motivación o issue relacionado: Closes #N>

## ¿Cómo se probó?
<pasos o comandos>

## Capturas / notas (si aplica)

## Checklist
- [ ] Lint, tipos y tests pasan
- [ ] Sin secretos ni código muerto
- [ ] Documentación actualizada (si aplica)
```

Reglas del PR:
- Pequeño y enfocado: idealmente menos de ~400 líneas cambiadas.
- Si el PR es muy grande, propón dividirlo antes de abrirlo.

## 8. Merge

- Usa **Squash and merge** para dejar un historial lineal, con un commit por PR que siga Conventional Commits.
- Elimina la rama remota y local después del merge.
- Después sincroniza:

```bash
git checkout main
git pull origin main
git branch -d <rama>
```

## 9. Versionado y releases (SemVer)

- Versión `MAJOR.MINOR.PATCH`:
  - `fix` → PATCH
  - `feat` → MINOR
  - `BREAKING CHANGE` → MAJOR
- Para publicar una versión:

```bash
git checkout main && git pull origin main
git tag -a vX.Y.Z -m "release: vX.Y.Z"
git push origin vX.Y.Z
```

- Mantén un `CHANGELOG.md` actualizado, agrupado por tipo (Features, Fixes, etc.).

## 10. Hotfixes

1. Crea `hotfix/<descripcion>` desde `main`.
2. Corrige con el mínimo cambio posible y agrega un test que reproduzca el bug.
3. PR → merge → tag con PATCH incrementado.

## 11. Prohibiciones

- Push directo a `main`.
- `git push --force` sin `--with-lease`, o force push a `main`.
- Commits con secretos, `.env`, `node_modules`, builds o archivos del sistema.
- Mezclar cambios no relacionados en una misma rama o PR.
- Ignorar errores de lint, tipos o tests para "subir rápido".

## 12. Cómo debes reportarme

Antes de ejecutar `git push`, muéstrame:
1. El nombre de la rama.
2. La lista de commits (`git log --oneline origin/main..HEAD`).
3. El resultado del checklist.

Espera mi confirmación antes de pushear o hacer merge.
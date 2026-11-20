#!/bin/sh
# Entrypoint of the `dev` images (apps/backend/Dockerfile, apps/webapp/Dockerfile).
#
# Runs the container's command as whoever owns the checkout, not as root.
#
# compose.yaml bind-mounts the project over `/app`, and the dev servers write into it at
# start-up: `apps/backend/dist` (`nest start --watch`), `libs/core/dist` (`nx build core`),
# `apps/webapp/.nuxt` (`nuxt dev`). Run as root, every one of those is owned by root on a
# Linux host, and the developer cannot delete their own build output without `sudo`. Forge's
# own docker e2e failed on every push for exactly that reason before this existed.
#
# The owner of `/app` IS the host user, so it is read rather than passed in. `${UID}` is a
# shell variable that most shells never export, so `user: "${UID}:${GID}"` in compose.yaml
# would quietly fall back to whatever default it was given — and would have to be repeated
# by anyone who runs `docker compose up` instead of `npm run dev:up`.
#
# Owner 0 means there is nothing to fix, and the command runs as root as before:
#   - Docker Desktop (macOS, Windows) reports the mount as root-owned and maps everything
#     written through it back to the host user on its own;
#   - rootless Docker maps container root to the host user, so root is already right;
#   - a host user who is root owns root's files.
#
# `docker compose exec` does not pass through here, so `npm run dev:migrate` still runs as
# root. It writes nothing into the checkout, so that is harmless; anything added to the
# `exec` path that does write should pass `--user "$(id -u):$(id -g)"`.
set -eu

uid=$(stat -c %u /app)
gid=$(stat -c %g /app)

if [ "$uid" = 0 ]; then
  exec "$@"
fi

# The anonymous volumes compose.yaml layers over the bind mount are filled from the image
# on first use, so they are root-owned, and the dev servers write into them (Vite and Nuxt
# cache under `node_modules/.cache`, Nx under `.nx`). Hand them to the same user.
#
# Contents first, the directory itself last: its owner is the marker that the walk
# finished, so a restart skips a volume that is already done and redoes one that was
# interrupted, rather than trusting a half-finished walk.
for dir in /app/node_modules /app/apps/backend/node_modules /app/apps/webapp/node_modules /app/.nx; do
  [ -d "$dir" ] || continue
  [ "$(stat -c %u "$dir")" = "$uid" ] && continue
  find "$dir" -mindepth 1 ! -uid "$uid" -exec chown -h "$uid:$gid" {} +
  chown "$uid:$gid" "$dir"
done

# Node and npm both expect the user to exist and to have a writable home: `os.userInfo()`
# throws for an unknown uid, and npm writes its cache and logs under `$HOME`. The image's
# own `node` user is uid 1000, so the commonest host uid needs nothing added.
if ! getent passwd "$uid" > /dev/null; then
  mkdir -p /home/dev
  chown "$uid:$gid" /home/dev
  echo "dev:x:$uid:$gid:dev:/home/dev:/bin/sh" >> /etc/passwd
fi
home=$(getent passwd "$uid" | cut -d: -f6)

exec setpriv --reuid="$uid" --regid="$gid" --clear-groups env HOME="$home" "$@"

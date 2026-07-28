FROM node:20-alpine

WORKDIR /app

# Instala deps ANTES de copiar el código: esta capa se cachea y solo se
# re-ejecuta cuando cambian package.json / package-lock.json (no en cada deploy).
# npm ci es más rápido y determinista que npm install; --no-audit/--no-fund evitan
# trabajo de red/CPU inútil. Fallback a npm install por si el lock va desajustado.
COPY package*.json ./
RUN npm ci --no-audit --no-fund --prefer-offline || npm install --no-audit --no-fund

# Copia el resto del código. Con .dockerignore el contexto es pequeño (sin
# node_modules/.next/.git) → copia rápida y la caché de arriba se mantiene.
COPY . .

# Límite de heap del build AJUSTADO al servidor (3,8 GB de RAM). Pedir 4096 en un
# servidor de 3,8 GB provoca swap a disco → build lentísimo y CPU al 100%. Con 2560
# el build cabe en RAM (verificado: compila las 127 páginas sin OOM) y va mucho más
# rápido, dejando ~1,2 GB para el SO y los workers de generación estática.
ENV NODE_OPTIONS="--max-old-space-size=2560"
RUN npm run build

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
# Heap más grande en runtime para schedulers + IMAP sync de muchas cuentas
ENV NODE_OPTIONS="--max-old-space-size=3072 --expose-gc"

CMD ["npm", "start"]

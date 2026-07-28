FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

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

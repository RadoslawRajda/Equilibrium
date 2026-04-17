FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY personas ./personas
COPY skills ./skills
COPY src ./src
RUN npx tsc
CMD ["node", "dist/index.js"]

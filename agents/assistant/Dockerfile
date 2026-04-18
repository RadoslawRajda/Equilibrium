FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc
EXPOSE 4060
EXPOSE 9100
CMD ["sh", "-lc", "DEP=\"${DEPLOYMENTS_PATH:-/contracts/deployments/localhost.json}\"; until [ -f \"$DEP\" ]; do echo \"[assistant-agent] waiting for deployments at $DEP\"; sleep 2; done; node dist/index.js"]

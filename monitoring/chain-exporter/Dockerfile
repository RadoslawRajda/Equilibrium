FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install
COPY index.mjs ./
EXPOSE 9100
CMD ["sh", "-lc", "DEP=\"${DEPLOYMENTS_PATH:-/contracts/deployments/localhost.json}\"; until [ -f \"$DEP\" ]; do echo \"[chain-exporter] waiting for deployments at $DEP\"; sleep 3; done; node index.mjs"]

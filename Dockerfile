# BYTEFORGE container: compiles the root-level C++17 sources, then runs Express.
FROM node:20-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends g++ make \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# main.cpp and every other .cpp file live in the repository root.
RUN mkdir -p bin && g++ -std=c++17 -O2 -Wall -Wextra -o bin/byteforge *.cpp \
 && ./bin/byteforge --version

RUN chown -R node:node /app
USER node

# Render injects PORT; server.js binds 0.0.0.0:$PORT.
EXPOSE 3000
CMD ["node", "server.js"]

FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir docling

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY lib/ lib/
COPY routes/ routes/
COPY server.ts ./
COPY docling_worker.py ./

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001
ENV DOCLING_PYTHON_PATH=python3
ENV DOCLING_MODEL=smoldocling
ENV DOCLING_WORKER_PATH=/app/docling_worker.py
ENV DOCLING_TIMEOUT_MS=600000

EXPOSE 3001

CMD ["node", "dist/server.js"]

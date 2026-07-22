FROM node:20-bookworm AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_ZAI_API_KEY
ARG VITE_OPENAI_API_KEY
ARG VITE_XAI_API_KEY
ENV VITE_ZAI_API_KEY=$VITE_ZAI_API_KEY
ENV VITE_OPENAI_API_KEY=$VITE_OPENAI_API_KEY
ENV VITE_XAI_API_KEY=$VITE_XAI_API_KEY

RUN npm run build

FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]

FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_AUTH_DISABLED
ARG VITE_API_BASE
ENV VITE_AUTH_DISABLED=${VITE_AUTH_DISABLED}
ENV VITE_API_BASE=${VITE_API_BASE}
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80

FROM node:9-alpine
ENV PORT=80
ENV NODE_ENV=production
WORKDIR /app
ADD . .
RUN npm install -i
EXPOSE 80
CMD ["node", "index.js"]
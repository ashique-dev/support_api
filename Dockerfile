# FROM node:20-alpine AS builder
# WORKDIR /app
# COPY package*.json ./
# RUN npm install
# # RUN npm ci
# COPY . .
# RUN npm run build

# FROM node:20-alpine AS production
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci --only=production
# COPY --from=builder /app/dist ./dist
# EXPOSE 3000
# CMD ["node", "dist/main"]


FROM node:20-alpine

WORKDIR /app

# Copy dependency files first (for caching)
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm install

# Copy full source
COPY . .

# Build the application
RUN npm run build

# Expose app port
EXPOSE 3000

# Run the built app
CMD ["node", "dist/main"]

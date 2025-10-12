# Use Node.js LTS as base image
FROM node:18-slim

# Install build dependencies and system tools
RUN apt-get update && apt-get install -y \
    git \
    automake \
    autoconf \
    libtool \
    pkg-config \
    make \
    g++ \
    zlib1g-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Build and install BWFMetaEdit from source
RUN git clone https://github.com/MediaArea/BWFMetaEdit.git /tmp/BWFMetaEdit && \
    cd /tmp/BWFMetaEdit/Project/GNU/CLI && \
    ./autogen.sh && \
    ./configure && \
    make && \
    make install && \
    cd / && \
    rm -rf /tmp/BWFMetaEdit

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the TypeScript project
RUN npm run build

# Remove dev dependencies to reduce image size
RUN npm prune --production

# Create non-root user
RUN groupadd -r appuser && useradd -r -g appuser appuser

# Create necessary directories and set proper ownership
RUN mkdir -p uploads temp outputs && \
    chown -R appuser:appuser /usr/src/app

# Expose port
EXPOSE 3000

# Switch to non-root user
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["npm", "start"]
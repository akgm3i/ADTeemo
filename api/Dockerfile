# Use the official Deno image as a base
FROM denoland/deno:1.42.0

# Set the working directory in the container
WORKDIR /app

# Expose the port the app runs on
EXPOSE 8000

# Copy dependency definition
COPY deno.json .

# Copy source code and other assets
COPY src ./src
COPY drizzle.config.ts .
COPY drizzle ./drizzle

# Cache dependencies. Deno will see "nodeModulesDir": "auto" in deno.json
# and create the node_modules directory.
RUN deno cache src/main.ts

# Specify the command to run on container start
CMD ["run", "--allow-net", "--allow-read", "--allow-env", "--allow-write", "src/main.ts"]

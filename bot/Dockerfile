# Use the official Deno image as a base
FROM denoland/deno:1.42.0

# Set the working directory in the container
WORKDIR /app

# Copy dependency definition
COPY deno.json .

# Copy source code
COPY src ./src

# Cache dependencies. Deno will see "nodeModulesDir": "auto" from deno.json if needed.
RUN deno cache src/main.ts

# Specify the command to run on container start
# The bot needs network access for Discord/API and env vars for the token.
CMD ["run", "--allow-net", "--allow-read", "--allow-env", "src/main.ts"]

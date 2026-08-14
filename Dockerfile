FROM apify/actor-node-playwright-chrome:22

COPY --chown=myuser:myuser package*.json ./

RUN npm --quiet set progress=false \
    && npm install --omit=dev --include=optional \
    && node -e "import('impit').then(() => console.log('impit native client OK'))" \
    && rm -rf ~/.npm

COPY --chown=myuser:myuser . ./

CMD npm start --silent

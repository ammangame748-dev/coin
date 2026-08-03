const express = require('express');
const server = express();

server.all('/', (req, res) => {
    res.send('🛡️ Wano Security Bot is Online!');
});

function keepAlive() {
    server.listen(3000, () => {
        console.log("✅ Server is Ready! (Port 3000)");
    });
}

module.exports = keepAlive;

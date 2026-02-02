/* ARQUIVO: api/consulta.js (VERSÃO FINAL - BROWSERLESS) */
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // Configurações de CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    let browser = null;

    try {
        // --- CONEXÃO COM O BROWSERLESS ---
        // Sua chave já está configurada abaixo:
        const MINHA_CHAVE = '2TuHdl0Zj5Tj5PP1fa3eec3f1e757ededf8f76377a5ba7385'; 

        console.log("🚀 Conectando ao Browserless...");
        
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${MINHA_CHAVE}`
        });

        const page = await browser.newPage();
        
        // 1. Entra no site
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // 2. Digita o Renavam
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 20000 });
        await page.type(inputRenavam, renavam);

        // 3. Clica em Consultar
        let botaoConsultar = 'div[id*="ig1:b11"]';
        if ((await page.$(botaoConsultar)) === null) botaoConsultar = 'div[id*="ig1:b1"]';
        
        await Promise.all([
            new Promise(r => setTimeout(r, 1000)),
            page.click(botaoConsultar)
        ]);

        // 4. Espera Resultado
        try {
            await page.waitForFunction(
                () => {
                    const el = document.querySelector('span[id*="ot2"]');
                    return el && el.innerText.length > 3;
                },
                { timeout: 30000 } 
            );
        } catch (e) {
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 400));
            throw new Error(`Erro: Site abriu mas não carregou dados. Texto: ${textoTela}`);
        }

        // 5. Raspa Dados
        const dados = await page.evaluate(() => {
            const pegarTexto = (parteDoId) => {
                const el = document.querySelector(`span[id*="${parteDoId}"]`);
                return el ? el.innerText : "N/A";
            };
            return {
                proprietario: pegarTexto('ot2'),    
                renavam: pegarTexto('ot6'),         
                placa: pegarTexto('ot8'),
                modelo: pegarTexto('ot10'),
                ano: pegarTexto('ot12'),
                debitos: []
            };
        });

        const valores = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('span'))
                .map(s => s.innerText)
                .filter(t => t.includes('R$'));
        });
        dados.debitos = valores;

        await browser.close();
        res.json(dados);

    } catch (error) {
        if (browser) await browser.close();
        console.error(error);
        res.status(500).json({ 
            erro: 'Erro Remoto: ' + error.message 
        });
    }
};

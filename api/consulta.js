/* ARQUIVO: api/consulta.js (VERSÃO NODE 18 - ESTÁVEL) */
const chromium = require('@sparticuz/chromium');
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
        // CONFIGURAÇÃO CLÁSSICA PARA NODE 18
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // Entra no site
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', 
            timeout: 20000 
        });

        // Digita Renavam
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 10000 });
        await page.type(inputRenavam, renavam);

        // Clica em Consultar
        let botaoConsultar = 'div[id*="ig1:b11"]';
        if ((await page.$(botaoConsultar)) === null) botaoConsultar = 'div[id*="ig1:b1"]';
        
        await Promise.all([
            new Promise(r => setTimeout(r, 500)), // Pequeno respiro
            page.click(botaoConsultar)
        ]);

        // Espera resultado
        try {
            await page.waitForFunction(
                () => {
                    const el = document.querySelector('span[id*="ot2"]');
                    return el && el.innerText.length > 3;
                },
                { timeout: 20000 } 
            );
        } catch (e) {
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 300));
            throw new Error(`Erro: Site não carregou os dados. Texto visível: ${textoTela}`);
        }

        // Pega dados
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
        res.status(500).json({ erro: error.message });
    }
};

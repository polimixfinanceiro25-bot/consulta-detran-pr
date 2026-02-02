/* ARQUIVO: api/consulta.js (VERSÃO NODE 20 - CHROMIUM MIN) */
const chromium = require('@sparticuz/chromium-min');
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
        // --- CONFIGURAÇÃO PARA NODE 20 (AMAZON LINUX 2023) ---
        // 1. Aponta para o link do Chrome v123 (Compatível com Node 20)
        const remoteExecutablePath = "https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar";

        // 2. Configura o robô
        browser = await puppeteer.launch({
            args: [
                ...chromium.args,
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--single-process' // Ajuda a rodar em ambientes restritos
            ],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(remoteExecutablePath),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // 3. Navegação (Seu código validado)
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', 
            timeout: 30000 
        });

        // Digita Renavam
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 15000 });
        await page.type(inputRenavam, renavam);

        // Clica Consultar
        let botaoConsultar = 'div[id*="ig1:b11"]';
        if ((await page.$(botaoConsultar)) === null) botaoConsultar = 'div[id*="ig1:b1"]';
        
        await Promise.all([
            new Promise(r => setTimeout(r, 1000)), // Pausa segura
            page.click(botaoConsultar)
        ]);

        // Espera Resultado (Com diagnóstico de erro)
        try {
            await page.waitForFunction(
                () => {
                    const el = document.querySelector('span[id*="ot2"]');
                    return el && el.innerText.length > 3;
                },
                { timeout: 25000 } 
            );
        } catch (e) {
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 400));
            throw new Error(`O site abriu mas não mostrou os dados. Texto na tela: ${textoTela}`);
        }

        // Raspa Dados
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
            erro: 'Erro Técnico: ' + error.message 
        });
    }
};

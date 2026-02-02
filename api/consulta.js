/* ARQUIVO: api/consulta.js (VERSÃO PUPPETEER - O ROBÔ QUE USA CHROME) */
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // Configurações de Segurança da API
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    let browser = null;

    try {
        // 1. Inicia o Navegador Invisível (Chrome)
        // Usa configurações especiais para rodar rápido na Vercel
        browser = await puppeteer.launch({
            args: chromium.args,
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // 2. Acessa a página (Portaria)
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';
        await page.goto(urlHome, { waitUntil: 'networkidle2' });

        // SEUS IDs DESCOBERTOS
        const idInputRenavam = '#pt1\\:r1\\:0\\:r2\\:0\\:ig1\\:it1\\:\\:content'; // Ajustado para seletor CSS
        const idBotaoConsultar = '#pt1\\:r1\\:0\\:r2\\:0\\:ig1\\:b1'; // Ajustado para seletor CSS

        // 3. Digita o Renavam
        // Espera o campo aparecer na tela
        await page.waitForSelector(idInputRenavam, { timeout: 10000 });
        await page.type(idInputRenavam, renavam);

        // 4. Clica no Botão e Espera Navegar
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }), // Espera a página mudar
            page.click(idBotaoConsultar) // Clica
        ]);

        // 5. Coleta os Dados da Nova Página
        // Verifica se achou o proprietário
        const proprietarioEl = await page.$('[id$=":ot2"]');
        
        if (!proprietarioEl) {
            // Se falhar, tira um "print" do texto da tela para sabermos o erro
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 200));
            throw new Error(`Não encontrei os dados na tela final. Texto visível: ${textoTela}`);
        }

        // Função interna para pegar texto limpo
        const extrair = async (idFinal) => {
            return await page.evaluate((final) => {
                const el = document.querySelector(`[id$="${final}"]`);
                return el ? el.innerText : '';
            }, idFinal);
        };

        const dados = {
            proprietario: await extrair(':ot2'),
            renavam: await extrair(':ot6'),
            placa: await extrair(':ot8'),
            modelo: await extrair(':ot10'),
            ano: await extrair(':ot12'),
            debitos: []
        };

        // Pega os valores em R$
        const valores = await page.evaluate(() => {
            const spans = Array.from(document.querySelectorAll('span'));
            return spans
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
            erro: 'Erro no Robô: ' + error.message 
        });
    }
};

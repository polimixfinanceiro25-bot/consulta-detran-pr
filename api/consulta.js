/* ARQUIVO: api/consulta.js (VERSÃO FINAL 2026 - CORREÇÃO LIBNSS3) */
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // Configurações de Segurança
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    let browser = null;

    try {
        // 1. CONFIGURAÇÃO DE LIGAR O ROBÔ (MODERNO)
        // Usamos a versão 131 que corrige o erro de libnss3 automaticamente
        browser = await puppeteer.launch({
            args: [...chromium.args, '--hide-scrollbars', '--disable-web-security'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(), // Agora é uma função!
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // 2. Entra no site
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';
        await page.goto(urlHome, { waitUntil: 'networkidle2', timeout: 25000 });

        // 3. Digita o Renavam (SELETOR DO SEU CÓDIGO LOCAL)
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 15000 });
        await page.type(inputRenavam, renavam);

        // 4. Clica no botão Consultar (SELETOR DO SEU CÓDIGO LOCAL)
        let botaoConsultar = 'div[id*="ig1:b11"]';
        
        // Verifica se o botão existe antes de clicar
        if ((await page.$(botaoConsultar)) === null) {
             botaoConsultar = 'div[id*="ig1:b1"]'; // Plano B
        }
        
        // Clique robusto (via Javascript) para garantir que o Detran aceite
        await page.evaluate((btnSelector) => {
            const btn = document.querySelector(btnSelector);
            if (btn) btn.click();
        }, botaoConsultar);

        // 5. ESPERA INTELIGENTE
        // Espera aparecer o nome do proprietário ou qualquer dado
        try {
            await page.waitForFunction(
                () => {
                    const el = document.querySelector('span[id*="ot2"]');
                    return el && el.innerText.length > 3;
                },
                { timeout: 20000 } 
            );
        } catch (e) {
            // Se der erro de tempo, pegamos o texto da tela para saber o motivo (ex: Captcha)
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 400));
            throw new Error(`O site demorou para responder. Pode ser Captcha ou lentidão. Texto na tela: ${textoTela}`);
        }

        // 6. Raspa os dados (Exatamente como no seu local)
        const dados = await page.evaluate(() => {
            const pegarTexto = (parteDoId) => {
                const el = document.querySelector(`span[id*="${parteDoId}"]`);
                return el ? el.innerText : "Não encontrado";
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

        // Pega os valores (R$)
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
            erro: 'Erro no Robô: ' + error.message 
        });
    }
};

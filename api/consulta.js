/* ARQUIVO: api/consulta.js (VERSÃO OLD RELIABLE - COMPATIBILIDADE MÁXIMA) */
const chrome = require('chrome-aws-lambda');
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
        // 1. CONFIGURAÇÃO BLINDADA PARA VERCEL
        // Usamos as opções nativas do 'chrome-aws-lambda' que evitam erros de biblioteca
        browser = await puppeteer.launch({
            args: [...chrome.args, '--hide-scrollbars', '--disable-web-security'],
            defaultViewport: chrome.defaultViewport,
            executablePath: await chrome.executablePath, // O segredo está aqui
            headless: chrome.headless,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // 2. Entra no site
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';
        await page.goto(urlHome, { waitUntil: 'networkidle2', timeout: 20000 });

        // 3. Digita o Renavam (SELETOR DO SEU CÓDIGO LOCAL)
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 10000 });
        await page.type(inputRenavam, renavam);

        // 4. Clica no botão Consultar (SELETOR DO SEU CÓDIGO LOCAL)
        let botaoConsultar = 'div[id*="ig1:b11"]';
        
        // Pequena verificação se o botão existe, senão tenta o plano B
        if ((await page.$(botaoConsultar)) === null) {
             botaoConsultar = 'div[id*="ig1:b1"]';
        }
        
        // Força o clique via Javascript para garantir (funciona melhor em versões antigas)
        await page.evaluate((btnSelector) => {
            const btn = document.querySelector(btnSelector);
            if (btn) btn.click();
        }, botaoConsultar);

        // 5. ESPERA INTELIGENTE
        // Espera o nome do proprietário aparecer
        try {
            await page.waitForFunction(
                () => {
                    const el = document.querySelector('span[id*="ot2"]');
                    return el && el.innerText.length > 3;
                },
                { timeout: 15000 } 
            );
        } catch (e) {
            // Se der erro, pegamos o texto da tela para ver se foi Captcha
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 300));
            throw new Error(`Tempo esgotado (Possível Captcha ou Bloqueio). Texto da tela: ${textoTela}`);
        }

        // 6. Raspa os dados (Lógica do seu código local)
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

        // Pega valores financeiros
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

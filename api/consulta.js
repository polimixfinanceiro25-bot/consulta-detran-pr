/* ARQUIVO: api/consulta.js (VERSÃO FINAL - DIGITAÇÃO HUMANA) */
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // 1. Configurações de Segurança
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    let browser = null;

    try {
        // 2. CONEXÃO BROWSERLESS
        const MINHA_CHAVE = '2TuHdl0Zj5Tj5PP1fa3eec3f1e757ededf8f76377a5ba7385'; 
        
        console.log("🚀 Iniciando (Modo Humano)...");
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${MINHA_CHAVE}&stealth`
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        // 3. Entra no site
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // 4. INTERAÇÃO LENTA (Para acordar o Oracle ADF)
        const seletorInput = 'input[id*="it1::content"]'; 
        const seletorBotao = 'div[id*="b11"]';

        await page.waitForSelector(seletorInput, { timeout: 20000 });

        // A. Clica e foca no campo
        await page.click(seletorInput);
        await new Promise(r => setTimeout(r, 500)); // Espera o campo "acordar"

        // B. Digita devagar (100ms entre cada tecla) - Isso ativa a validação do site
        await page.type(seletorInput, renavam, { delay: 150 });
        
        // C. Aperta TAB para sair do campo (Obrigatório no Detran para validar o número)
        await page.keyboard.press('Tab');
        await new Promise(r => setTimeout(r, 1000)); // Espera o site validar

        // D. Clica no botão Consultar (Tenta via mouse e via código pra garantir)
        let botaoEncontrado = await page.$(seletorBotao);
        if(!botaoEncontrado) {
             // Tenta seletor alternativo se o principal falhar
             seletorBotao = 'div[id*="b1"]'; 
        }

        await page.evaluate((btnSel) => {
            const b = document.querySelector(btnSel);
            if(b) b.click();
        }, seletorBotao);

        // 5. ESPERA RESULTADO
        try {
            await page.waitForFunction(
                () => {
                    const nome = document.querySelector('span[id*="ot2"]');
                    const erro = document.querySelector('.ui-messages-error-summary');
                    return (nome && nome.innerText.length > 2) || erro;
                },
                { timeout: 45000 } // Tempo generoso
            );
        } catch (e) {
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 500));
            throw new Error(`Detran não carregou. Tela parou em: ${textoTela}`);
        }

        // 6. VERIFICA ERROS DO DETRAN
        const erroDetran = await page.evaluate(() => {
            const el = document.querySelector('.ui-messages-error-summary');
            return el ? el.innerText : null;
        });

        if (erroDetran) {
            await browser.close();
            return res.json({ proprietario: "Mensagem do Detran: " + erroDetran });
        }

        // 7. RASPA DADOS
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
        res.status(500).json({ erro: 'Falha Técnica: ' + error.message });
    }
};

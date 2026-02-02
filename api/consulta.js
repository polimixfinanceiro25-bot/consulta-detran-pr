/* ARQUIVO: api/consulta.js (VERSÃO FINAL - FORÇAR ORACLE ADF) */
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // 1. Configurações de Segurança (CORS)
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
        console.log("🚀 Conectando (Modo Stealth)...");
        
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${MINHA_CHAVE}&stealth`
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 }); // Tela de PC

        // 3. Entra no site
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // 4. INJEÇÃO DE DADOS (A CORREÇÃO)
        // O site usa IDs dinâmicos, então pegamos partes do ID que não mudam
        const seletorInput = 'input[id*="it1::content"]'; 
        const seletorBotao = 'div[id*="b11"]'; // Botão Consultar

        await page.waitForSelector(seletorInput, { timeout: 20000 });

        // AQUI É A MÁGICA: Forçamos o valor e os eventos que o site exige
        await page.evaluate((sel, valor) => {
            const el = document.querySelector(sel);
            if(el) {
                el.value = valor;
                el.dispatchEvent(new Event('input', { bubbles: true })); // "Estou digitando"
                el.dispatchEvent(new Event('change', { bubbles: true })); // "Mudei o valor"
                el.dispatchEvent(new Event('blur', { bubbles: true }));   // "Sai do campo"
            }
        }, seletorInput, renavam);

        // Espera um segundinho para o site processar o texto
        await new Promise(r => setTimeout(r, 1000));

        // Clicamos no botão via código (mais garantido que o mouse)
        await page.waitForSelector(seletorBotao);
        await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if(btn) btn.click();
        }, seletorBotao);

        // 5. Espera Resultado
        // Aumentei para 40s porque a primeira consulta do dia no Detran costuma ser lenta
        try {
            await page.waitForFunction(
                () => {
                    const nome = document.querySelector('span[id*="ot2"]');
                    const erro = document.querySelector('.ui-messages-error-summary');
                    // Retorna TRUE se achou o nome OU uma mensagem de erro na tela
                    return (nome && nome.innerText.length > 2) || erro;
                },
                { timeout: 40000 } 
            );
        } catch (e) {
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 500));
            throw new Error(`Detran não respondeu a tempo. Tela parada em: ${textoTela}`);
        }

        // 6. Verifica se o Detran devolveu mensagem de erro (ex: Renavam não encontrado)
        const mensagemErro = await page.evaluate(() => {
            const el = document.querySelector('.ui-messages-error-summary');
            return el ? el.innerText : null;
        });

        if (mensagemErro) {
            // Se o site avisou erro, devolvemos isso para o usuário
            await browser.close();
            return res.json({ proprietario: "Erro Detran: " + mensagemErro });
        }

        // 7. Raspa os dados com Sucesso
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
            erro: 'Falha: ' + error.message 
        });
    }
};

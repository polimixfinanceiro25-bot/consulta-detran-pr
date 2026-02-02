/* ARQUIVO: api/consulta.js (VERSÃO FINAL - MODO ESPIÃO) */
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
        const MINHA_CHAVE = '2TuHdl0Zj5Tj5PP1fa3eec3f1e757ededf8f76377a5ba7385'; 

        console.log("🚀 Conectando ao Browserless (Modo Stealth)...");
        
        // ADICIONEI "&stealth" NA URL PARA ESCONDER QUE É ROBÔ
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${MINHA_CHAVE}&stealth`
        });

        const page = await browser.newPage();
        
        // Configura tamanho de tela de um PC comum (Ajuda a evitar layouts mobile)
        await page.setViewport({ width: 1366, height: 768 });

        // 1. Entra no site
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });

        // 2. Digita o Renavam
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 20000 });
        
        // Clica no campo, limpa e digita (para garantir)
        await page.click(inputRenavam);
        await page.type(inputRenavam, renavam, { delay: 100 }); // Digita devagar igual humano

        // 3. O PULO DO GATO: Aperta ENTER em vez de clicar
        console.log("⌨️ Apertando ENTER...");
        await page.keyboard.press('Enter');

        // 4. Espera Resultado (Aumentei a tolerância)
        try {
            await page.waitForFunction(
                () => {
                    // Procura o nome do proprietário (ot2) OU msg de erro (messages)
                    const nome = document.querySelector('span[id*="ot2"]');
                    const erro = document.querySelector('.ui-messages-error-summary'); 
                    return (nome && nome.innerText.length > 3) || erro;
                },
                { timeout: 30000 } 
            );
        } catch (e) {
            // Se der timeout, tira um "print" do texto da tela para sabermos o que houve
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 500));
            throw new Error(`O Detran bloqueou ou demorou. O que está na tela: ${textoTela}`);
        }

        // 5. Verifica se deu erro de "Renavam Inválido" na tela
        const erroNaTela = await page.evaluate(() => {
            const el = document.querySelector('.ui-messages-error-summary');
            return el ? el.innerText : null;
        });

        if (erroNaTela) {
            throw new Error(`Detran respondeu: ${erroNaTela}`);
        }

        // 6. Raspa Dados (Se chegou aqui, deu certo!)
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
            erro: 'Erro: ' + error.message 
        });
    }
};

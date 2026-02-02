/* ARQUIVO: api/consulta.js (VERSÃO CAÇADOR - BUSCA POR TEXTO) */
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    let browser = null;

    try {
        // 1. CONEXÃO (Sua chave já está aqui)
        const MINHA_CHAVE = '2TuHdl0Zj5Tj5PP1fa3eec3f1e757ededf8f76377a5ba7385'; 
        console.log("🚀 Caçador Iniciado...");
        
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${MINHA_CHAVE}&stealth`
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        // 2. Navegação
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', timeout: 60000 
        });

        // 3. ESTRATÉGIA CAÇADOR: Encontrar input pelo ID genérico (mais seguro)
        // O seletor local era "input[id*="ig1:it1::content"]"
        const seletorInput = 'input[id*="it1::content"]';
        await page.waitForSelector(seletorInput, { timeout: 20000 });

        // Digita devagar
        await page.click(seletorInput);
        await new Promise(r => setTimeout(r, 300));
        await page.type(seletorInput, renavam, { delay: 150 });
        await page.keyboard.press('Tab'); // Valida o campo
        
        // --- VERIFICAÇÃO DE SEGURANÇA ---
        // O robô lê o campo para ver se o número entrou mesmo
        const valorDigitado = await page.$eval(seletorInput, el => el.value);
        if (valorDigitado !== renavam) {
            // Se falhou, tenta forçar via Javascript (Plano B)
            await page.evaluate((sel, val) => { document.querySelector(sel).value = val; }, seletorInput, renavam);
        }

        // 4. CLIQUE PELO TEXTO (Caça o botão escrito "CONSULTAR")
        // Isso resolve o problema de ID errado ou botão escondido
        console.log("🔎 Procurando botão 'CONSULTAR'...");
        const clicou = await page.evaluate(() => {
            // Pega todos os botões e divs da tela
            const elementos = Array.from(document.querySelectorAll('div, button, a, span'));
            // Acha aquele que tem o texto exato
            const botao = elementos.find(el => el.innerText && el.innerText.toUpperCase().trim() === 'CONSULTAR');
            if (botao) {
                botao.click();
                return true;
            }
            return false;
        });

        if (!clicou) {
            // Se não achou pelo texto, tenta pelo ID antigo (Plano C)
            const btnBackup = 'div[id*="b11"]';
            if (await page.$(btnBackup)) await page.click(btnBackup);
        }

        // 5. ESPERA RESULTADO
        try {
            await page.waitForFunction(
                () => {
                    const proprietario = document.querySelector('span[id*="ot2"]');
                    const erro = document.querySelector('.ui-messages-error-summary'); // Msg de erro do site
                    return (proprietario && proprietario.innerText.length > 2) || erro;
                },
                { timeout: 40000 } 
            );
        } catch (e) {
            // Se der erro, me mostra o que tem na tela (ex: "Renavam não encontrado" ou só a Home)
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 400));
            throw new Error(`Não carregou. O robô digitou "${valorDigitado}" e a tela parou em: ${textoTela}`);
        }

        // 6. RASPA DADOS
        // Primeiro, vê se o Detran deu mensagem de erro (ex: Renavam não existe)
        const msgErroDetran = await page.evaluate(() => {
            const el = document.querySelector('.ui-messages-error-summary');
            return el ? el.innerText : null;
        });

        if (msgErroDetran) {
            await browser.close();
            return res.json({ proprietario: "DETRAN RESPONDEU: " + msgErroDetran });
        }

        // Se passou, pega os dados
        const dados = await page.evaluate(() => {
            const pegar = (id) => {
                const el = document.querySelector(`span[id*="${id}"]`);
                return el ? el.innerText : "N/A";
            };
            return {
                proprietario: pegar('ot2'),    
                renavam: pegar('ot6'),         
                placa: pegar('ot8'),
                modelo: pegar('ot10'),
                ano: pegar('ot12'),
                debitos: []
            };
        });

        // Pega valores
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

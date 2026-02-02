/* ARQUIVO: api/consulta.js (VERSÃO FINAL - METRALHADORA DE CLIQUES) */
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // Configurações padrão
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    let browser = null;

    try {
        const MINHA_CHAVE = '2TuHdl0Zj5Tj5PP1fa3eec3f1e757ededf8f76377a5ba7385'; 
        
        console.log("🚀 Iniciando Operação Metralhadora...");
        browser = await puppeteer.connect({
            browserWSEndpoint: `wss://chrome.browserless.io?token=${MINHA_CHAVE}&stealth`
        });

        const page = await browser.newPage();
        await page.setViewport({ width: 1366, height: 768 });

        // 1. Entra no site
        await page.goto('https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home', { 
            waitUntil: 'networkidle2', timeout: 60000 
        });

        // 2. Digita o Renavam (Sabemos que isso já funciona!)
        const seletorInput = 'input[id*="it1::content"]'; 
        await page.waitForSelector(seletorInput, { timeout: 20000 });
        
        await page.click(seletorInput);
        await new Promise(r => setTimeout(r, 500));
        await page.type(seletorInput, renavam, { delay: 100 });
        await page.keyboard.press('Tab'); // Valida o campo
        await new Promise(r => setTimeout(r, 500));

        // 3. A METRALHADORA DE CLIQUES (Tenta tudo para enviar)
        console.log("🔫 Tentando enviar de todas as formas...");

        // TENTATIVA A: Apertar ENTER (Geralmente infalível)
        await page.keyboard.press('Enter');
        await new Promise(r => setTimeout(r, 1000));

        // TENTATIVA B: Clicar no botão pelo ID (Original)
        const btnID = await page.$('div[id*="b11"]');
        if (btnID) {
            await btnID.click();
            await new Promise(r => setTimeout(r, 1000));
        }

        // TENTATIVA C: Clicar pelo TEXTO exato (XPath)
        // Procura qualquer div, span ou link que tenha a palavra "CONSULTAR"
        const botoesTexto = await page.$x("//*[contains(text(), 'CONSULTAR') or contains(text(), 'Consultar')]");
        if (botoesTexto.length > 0) {
            await botoesTexto[0].click();
        }

        // 4. Espera o Resultado
        try {
            await page.waitForFunction(
                () => {
                    const proprietario = document.querySelector('span[id*="ot2"]');
                    const erro = document.querySelector('.ui-messages-error-summary');
                    return (proprietario && proprietario.innerText.length > 2) || erro;
                },
                { timeout: 40000 } 
            );
        } catch (e) {
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 400));
            throw new Error(`Não carregou. O robô digitou "${renavam}", tentou clicar 3x, mas a tela parou em: ${textoTela}`);
        }

        // 5. Verifica erros do Detran
        const msgErro = await page.evaluate(() => {
            const el = document.querySelector('.ui-messages-error-summary');
            return el ? el.innerText : null;
        });

        if (msgErro) {
            await browser.close();
            return res.json({ proprietario: "DETRAN RETORNOU ERRO: " + msgErro });
        }

        // 6. Sucesso: Pega os dados
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

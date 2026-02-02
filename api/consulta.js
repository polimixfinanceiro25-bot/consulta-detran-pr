/* ARQUIVO: api/consulta.js (VERSÃO PARAQUEDAS - DOWNLOAD REMOTO) */
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
        // --- CONFIGURAÇÃO DE DOWNLOAD REMOTO (A SOLUÇÃO DO LIBNSS3) ---
        // Aqui nós forçamos ele a baixar um Chrome específico que funciona no Linux da Vercel
        const linkDoChrome = "https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar";
        
        browser = await puppeteer.launch({
            args: [...chromium.args, '--hide-scrollbars', '--disable-web-security', '--no-sandbox'],
            defaultViewport: chromium.defaultViewport,
            // O Segredo: Passamos o link para ele baixar na hora
            executablePath: await chromium.executablePath(linkDoChrome),
            headless: chromium.headless,
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // 2. Entra no site
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';
        await page.goto(urlHome, { waitUntil: 'networkidle2', timeout: 30000 });

        // 3. Digita o Renavam (SELETOR DO SEU CÓDIGO LOCAL)
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 15000 });
        await page.type(inputRenavam, renavam);

        // 4. Clica no botão Consultar (SELETOR DO SEU CÓDIGO LOCAL)
        // O seu código local usava "ig1:b11", vamos priorizar ele
        let botaoConsultar = 'div[id*="ig1:b11"]';
        
        // Se não achar o b11, tenta o b1
        if ((await page.$(botaoConsultar)) === null) {
             botaoConsultar = 'div[id*="ig1:b1"]';
        }
        
        // Clique via Javascript (mais seguro contra falhas de renderização)
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
                { timeout: 25000 } 
            );
        } catch (e) {
            // Se der erro, tira print do texto da tela
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 400));
            throw new Error(`Tempo esgotado. Texto na tela: ${textoTela}`);
        }

        // 6. Raspa os dados
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

/* ARQUIVO: api/consulta.js (SEU CÓDIGO LOCAL ADAPTADO PARA VERCEL) */
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

module.exports = async (req, res) => {
    // Configurações de Segurança (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body; // Pega do POST (igual estava fazendo antes)

    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    let browser = null;

    try {
        // --- 1. CONFIGURAÇÃO ESPECIAL PARA VERCEL (AQUI É O PULO DO GATO) ---
        // Em vez de launch() comum, usamos o executablePath do pacote sparticuz
        browser = await puppeteer.launch({
            args: [...chromium.args, '--no-sandbox', '--disable-setuid-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: await chromium.executablePath(),
            headless: chromium.headless, // Na Vercel TEM que ser headless (sem tela)
            ignoreHTTPSErrors: true
        });

        const page = await browser.newPage();
        
        // 2. Entra no site
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';
        await page.goto(urlHome, { waitUntil: 'networkidle2', timeout: 20000 });

        // 3. Digita o Renavam (Usando o seletor DO SEU CÓDIGO LOCAL)
        // O asterisco *= significa "contém", funciona mesmo se o ID mudar um pouco
        const inputRenavam = 'input[id*="ig1:it1::content"]'; 
        await page.waitForSelector(inputRenavam, { timeout: 10000 });
        await page.type(inputRenavam, renavam);

        // 4. Clica no botão Consultar (Usando o seletor DO SEU CÓDIGO LOCAL)
        // Você usou "ig1:b11" no local, mantive aqui. Adicionei fallback para b1 só por segurança.
        let botaoConsultar = 'div[id*="ig1:b11"]';
        const botaoExiste = await page.$(botaoConsultar);
        if (!botaoExiste) {
             botaoConsultar = 'div[id*="ig1:b1"]'; // Plano B
        }
        
        // Clica e espera a navegação começar
        await Promise.all([
             // Pequena pausa técnica para garantir que o clique pegue
             new Promise(r => setTimeout(r, 500)),
             page.click(botaoConsultar)
        ]);

        // 5. ESPERA INTELIGENTE (Igual ao seu código, mas com timeout)
        // Na Vercel não podemos usar timeout: 0 (infinito) senão trava o servidor.
        // Coloquei 15 segundos. Se tiver CAPTCHA, vai dar erro aqui, pois o robô não sabe resolver.
        try {
            await page.waitForFunction(
                () => {
                    const el = document.querySelector('span[id*="ot2"]'); // Nome do proprietário
                    return el && el.innerText.length > 3;
                },
                { timeout: 15000 } 
            );
        } catch (e) {
            // Se der timeout, tiramos um "print" do texto para saber o porquê (pode ser captcha)
            const textoTela = await page.evaluate(() => document.body.innerText.substring(0, 300));
            throw new Error(`Tempo esgotado! O site pediu Captcha ou demorou. Tela: ${textoTela}`);
        }

        // 6. Raspa os dados (Cópia exata da sua lógica local)
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
                debitos: [] // Se quiser pegar valores, adicionamos depois
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
            erro: 'Erro na Consulta: ' + error.message 
        });
    }
};

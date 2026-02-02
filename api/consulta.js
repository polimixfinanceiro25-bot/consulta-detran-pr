/* ARQUIVO: api/consulta.js (VERSÃO FINAL - COM REDIRECIONAMENTO) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // 1. Configurações
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    try {
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';
        
        // Cliente Axios customizado para não seguir redirects automaticamente (nós faremos isso manualmente para cuidar dos cookies)
        const client = axios.create({
            maxRedirects: 0,
            validateStatus: status => status >= 200 && status < 400
        });

        // --- PASSO 1: Pegar o Crachá (Cookies) na Home ---
        const page = await client.get(urlHome);
        let cookies = page.headers['set-cookie'] || [];
        
        const $ = cheerio.load(page.data);
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // SEUS IDs CORRETOS (CONFIRMADOS NAS FOTOS)
        const idInput = 'pt1:r1:0:r2:0:ig1:it1';
        const idBotao = 'pt1:r1:0:r2:0:ig1:b1';

        // --- PASSO 2: Enviar a Consulta ---
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'source': idBotao,
            'event': idBotao,
            [idInput]: renavam
        };

        // Prepara os cookies para envio
        const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

        const postResult = await client.post(urlHome, qs.stringify(form), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieStr,
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlHome
            }
        });

        // --- PASSO 3: O Pulo do Gato (Entrar na Sala Nova) ---
        let htmlFinal = postResult.data;
        
        // Se o Detran respondeu com "Vá para tal lugar" (Redirect 302 ou 303)
        if (postResult.status === 302 || postResult.status === 303 || postResult.headers.location) {
            const novaUrl = postResult.headers.location;
            
            // Atualiza cookies se vierem novos
            if (postResult.headers['set-cookie']) {
                cookies = [...cookies, ...postResult.headers['set-cookie']];
            }
            const cookieStrFinal = cookies.map(c => c.split(';')[0]).join('; ');

            // Segue para a nova página
            const pageFinal = await client.get(novaUrl, {
                headers: {
                    'Cookie': cookieStrFinal,
                    'Referer': urlHome
                }
            });
            htmlFinal = pageFinal.data;
        }

        // --- PASSO 4: Ler os Resultados ---
        const $res = cheerio.load(htmlFinal);
        const clean = (sel) => $res(sel).text().replace(/CDATA\[|\]\]/g, '').trim();

        const proprietario = clean('[id$=":ot2"]');

        if (!proprietario) {
            // AGORA O ERRO VAI APARECER COMPLETO
            // Eu juntei o texto técnico na mensagem principal para o pop-up mostrar
            const titulo = $res('title').text();
            const textoPagina = $res('body').text().replace(/\s+/g, ' ').substring(0, 150);
            
            return res.status(404).json({
                erro: `ERRO TÉCNICO: Título da pág: "${titulo}". Texto visível: "${textoPagina}". IDs usados: ${idInput} / ${idBotao}`
            });
        }

        const dados = {
            proprietario: proprietario,
            renavam: clean('[id$=":ot6"]'),
            placa: clean('[id$=":ot8"]'),
            modelo: clean('[id$=":ot10"]'),
            ano: clean('[id$=":ot12"]'),
            debitos: []
        };
        
        $res('span').each((i, el) => {
            const t = $(el).text();
            if (t.includes('R$')) dados.debitos.push(t.replace(/CDATA\[|\]\]/g, '').trim());
        });

        res.json(dados);

    } catch (e) {
        res.status(500).json({ erro: 'FALHA CRÍTICA: ' + e.message });
    }
};

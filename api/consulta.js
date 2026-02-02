/* ARQUIVO: api/consulta.js (VERSÃO COM ID DESCOBERTO) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // 1. Configurações e Segurança
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    try {
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';

        // 2. Acessa a Home (Portaria)
        const page = await axios.get(urlHome);
        const html = page.data;
        const $ = cheerio.load(html);

        const cookies = page.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // --- AQUI ESTÁ A CORREÇÃO ---
        // Usamos o ID exato que você descobriu na foto
        const idInputRenavam = 'pt1:r1:0:r2:0:ig1:it1';

        // --- CAÇADOR DE BOTÃO ---
        // Como não temos a foto do botão, usamos a busca por texto "CONSULTAR"
        let idBotaoConsultar = '';
        
        // Procura em todos os elementos visíveis
        $('a, button, div, span, input').each((i, el) => {
            const texto = $(el).text() ? $(el).text().toUpperCase() : ($(el).val() ? $(el).val().toUpperCase() : '');
            
            // Se achar "CONSULTAR" e tiver um ID, é esse o cara!
            if (texto.includes('CONSULTAR') || texto.includes('PESQUISAR')) {
                const id = $(el).attr('id');
                if (id) {
                    idBotaoConsultar = id;
                    return false; // Para de procurar
                }
            }
        });

        // Se a busca falhar, tenta um "chute" baseado no padrão do ID do Renavam
        // (Geralmente o botão está perto do input na hierarquia 'ig1')
        if (!idBotaoConsultar) {
             // Chute educado: pt1:r1:0:r2:0:ig1:b1 (ou cb1)
             idBotaoConsultar = 'pt1:r1:0:r2:0:ig1:cb1';
        }

        // 3. Disparo (POST)
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'source': idBotaoConsultar, 
            'event': idBotaoConsultar, 
            [idInputRenavam]: renavam
        };

        const result = await axios.post(urlHome, qs.stringify(form), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader,
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlHome
            }
        });

        // 4. Extração dos Dados
        const $res = cheerio.load(result.data);
        const clean = (sel) => $res(sel).text().replace(/CDATA\[|\]\]/g, '').trim();

        // Verifica se achou o proprietário
        const proprietario = clean('[id$=":ot2"]');

        if (!proprietario) {
            return res.status(404).json({
                erro: 'Não encontrei. O ID do Renavam eu usei certo, mas talvez errei o botão.',
                pista: `Botão que cliquei: ${idBotaoConsultar}. Input usado: ${idInputRenavam}`
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
        res.status(500).json({ erro: 'Erro interno: ' + e.message });
    }
};

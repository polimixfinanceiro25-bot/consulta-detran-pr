/* ARQUIVO: api/consulta.js (VERSÃO FINAL - IDs CONFIRMADOS) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // 1. Configurações de Segurança
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    try {
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';

        // 2. Acessa a Home (Portaria) para pegar Cookies e ViewState
        const page = await axios.get(urlHome);
        const html = page.data;
        const $ = cheerio.load(html);

        const cookies = page.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // 3. OS IDs EXATOS (Descobertos nas suas fotos)
        const idInputRenavam = 'pt1:r1:0:r2:0:ig1:it1'; // Foto 1
        const idBotaoConsultar = 'pt1:r1:0:r2:0:ig1:b1'; // Foto 2

        // 4. Disparo (O clique exato)
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

        // 5. Extração dos Dados
        const $res = cheerio.load(result.data);
        const clean = (sel) => $res(sel).text().replace(/CDATA\[|\]\]/g, '').trim();

        // Tenta pegar o proprietário (busca por elemento que termina com :ot2)
        const proprietario = clean('[id$=":ot2"]');

        // TRAVA DE SEGURANÇA
        if (!proprietario) {
            return res.status(404).json({
                erro: 'Veículo não encontrado.',
                debug: `Usei Renavam: ${idInputRenavam} e Botão: ${idBotaoConsultar}`
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
        
        // Pega os valores em R$
        $res('span').each((i, el) => {
            const t = $(el).text();
            if (t.includes('R$')) dados.debitos.push(t.replace(/CDATA\[|\]\]/g, '').trim());
        });

        res.json(dados);

    } catch (e) {
        res.status(500).json({ erro: 'Erro interno: ' + e.message });
    }
};

/* ARQUIVO: api/consulta.js (VERSÃO CORRETA - URL HOME) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // Configurações de Segurança
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    try {
        // AGORA SIM: A URL CORRETA DA "PORTARIA"
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';

        // 1. Acessa a Home para iniciar a sessão
        const page = await axios.get(urlHome);
        const html = page.data;
        const $ = cheerio.load(html);

        const cookies = page.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // 2. RASTREADOR DE IDs NA HOME
        
        // Procura o ID do campo Renavam
        let idInputRenavam = '';
        $('label').each((i, el) => {
            if ($(el).text().includes('Renavam')) idInputRenavam = $(el).attr('for');
        });
        if (!idInputRenavam) idInputRenavam = 'pt1:r1:0:it1'; // Padrão comum do Detran-PR

        // Procura o ID do Botão Consultar
        let idBotaoConsultar = '';
        $('*').each((i, el) => {
            if (el.tagName === 'script' || el.tagName === 'style') return;
            const texto = $(el).text() || $(el).attr('value') || $(el).attr('title') || '';
            const id = $(el).attr('id');

            // Procura botão que tenha "Consultar" no texto
            if (id && (texto.includes('Consultar') || texto.includes('Pesquisar'))) {
                 // Evita pegar links de menu, foca no botão do formulário
                 if (el.tagName === 'button' || el.tagName === 'a' || $(el).attr('role') === 'button') {
                     idBotaoConsultar = id;
                 }
            }
        });

        // Se não achar, usa o chute educado (baseado na estrutura do seu print anterior)
        if (!idBotaoConsultar) idBotaoConsultar = 'pt1:r1:0:cb1'; 

        // 3. Disparo (POST para a própria Home)
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

        // 4. Extração
        const $res = cheerio.load(result.data);
        const clean = (sel) => $res(sel).text().replace(/CDATA\[|\]\]/g, '').trim();

        // Tenta achar o proprietário para confirmar sucesso
        const proprietario = clean('[id$=":ot2"]');

        if (!proprietario) {
            // Debug avançado se falhar
            return res.status(404).json({
                erro: 'Não achei os dados.',
                pista: `URL usada: ${urlHome}. Botão: ${idBotaoConsultar}. Input: ${idInputRenavam}`
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

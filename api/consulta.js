/* ARQUIVO: api/consulta.js (VERSÃO RASTREADOR UNIVERSAL) */
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
        const urlAlvo = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/consultar-debitos-detalhes';

        // 1. Acessa a página
        const page = await axios.get(urlAlvo);
        const html = page.data;
        const $ = cheerio.load(html);

        const cookies = page.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // 2. RASTREADOR UNIVERSAL DE IDs
        // Procura o ID do campo Renavam
        let idInputRenavam = '';
        // Estratégia 1: Label for
        $('label').each((i, el) => {
            if ($(el).text().includes('Renavam')) idInputRenavam = $(el).attr('for');
        });
        // Estratégia 2: Input próximo a texto Renavam
        if (!idInputRenavam) {
             idInputRenavam = $('tr:contains("Renavam") input').attr('id') || 'pt1:r1:0:it1';
        }

        // Procura o ID do Botão Consultar
        let idBotaoConsultar = '';
        
        // Varre TODOS os elementos da página procurando "Consultar"
        $('*').each((i, el) => {
            // Ignora scripts e estilos
            if (el.tagName === 'script' || el.tagName === 'style') return;

            const texto = $(el).text() || $(el).attr('value') || $(el).attr('title') || '';
            const id = $(el).attr('id');

            // Se o elemento tem ID e tem a palavra mágica
            if (id && (texto.includes('Consultar') || texto.includes('Pesquisar'))) {
                // Preferência para inputs e buttons
                if (el.tagName === 'input' || el.tagName === 'button' || el.tagName === 'a') {
                     idBotaoConsultar = id;
                }
            }
        });

        // Se o rastreador falhar, usa o "chute" mais provável (baseado na estrutura ADF)
        // ADF costuma usar cb1 ou cb2 (CommandButton)
        if (!idBotaoConsultar) idBotaoConsultar = 'pt1:r1:0:cb1';
        
        // --- LOG DE DEBUG PARA VOCÊ (CASO FALHE) ---
        // Se ainda assim der erro, vamos saber exatamente o que o rastreador achou
        const debugInfo = `Botão achado: ${idBotaoConsultar} | Input achado: ${idInputRenavam}`;

        // 3. Disparo
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'source': idBotaoConsultar, 
            'event': idBotaoConsultar, 
            [idInputRenavam]: renavam
        };

        const result = await axios.post(urlAlvo, qs.stringify(form), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader,
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlAlvo
            }
        });

        // 4. Extração dos dados
        const $res = cheerio.load(result.data);
        
        // Função auxiliar de limpeza
        const clean = (sel) => $res(sel).text().replace(/CDATA\[|\]\]/g, '').trim();

        // Tenta pegar pelo ID final (ot2, ot6, etc)
        // O $ é um seletor de "termina com"
        const proprietario = clean('[id$=":ot2"]');

        if (!proprietario) {
            return res.status(404).json({
                erro: 'Não achei os dados. O rastreador usou estes IDs:',
                pista: debugInfo
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

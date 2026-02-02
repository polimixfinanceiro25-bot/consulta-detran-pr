/* ARQUIVO: api/consulta.js (VERSÃO SONDA - DEBUGGER) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // Headers padrões
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    try {
        const urlAlvo = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/consultar-debitos-detalhes';

        // 1. GET Inicial
        const page = await axios.get(urlAlvo);
        const html = page.data;
        const $ = cheerio.load(html);

        // Cookies e ViewState
        const cookies = page.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // --- A SONDA DE IDs ---
        
        // 1. Achar o Input do Renavam
        // Procura labels que tenham "Renavam" e pega o 'for'
        let idInput = $('label').filter((i, el) => $(el).text().includes('Renavam')).attr('for');
        if (!idInput) idInput = 'pt1:r1:0:it1'; // Fallback padrão

        // 2. Achar o Botão "Consultar"
        // Varre todos os elementos que possam ser botões e tenham o texto "Consultar"
        let idBotao = '';
        let listaBotoesEncontrados = []; // Para debug

        // Procura em tags <a>, <button>, <div> com role button
        $('a, button, div[role="button"]').each((i, el) => {
            const texto = $(el).text().trim();
            const id = $(el).attr('id');
            if (id) listaBotoesEncontrados.push(`${id} (${texto})`); // Guarda para te mostrar se der erro

            if (texto.includes('Consultar') || texto.includes('Pesquisar')) {
                idBotao = id;
            }
        });

        // Se a sonda falhou, tenta chutar o mais provável que não é o de Login (b1)
        if (!idBotao) {
            // Tenta achar um botão que NÃO seja o b1 (Login)
            const possivel = listaBotoesEncontrados.find(b => !b.includes('pt1:r1:0:b1'));
            if (possivel) idBotao = possivel.split(' ')[0];
            else idBotao = 'pt1:r1:0:cb1'; // Chute final
        }

        // --- DISPARO ---
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'source': idBotao, // ADF as vezes pede source
            'event': idBotao,
            [idInput]: renavam
        };

        const result = await axios.post(urlAlvo, qs.stringify(form), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader,
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlAlvo
            }
        });

        // --- EXTRAÇÃO ---
        const $res = cheerio.load(result.data);
        
        // Função limpadora
        const getVal = (idEnd) => {
            const el = $res(`[id$="${idEnd}"]`);
            return el.length ? el.text().replace(/CDATA\[|\]\]/g, '').trim() : '';
        };

        const dados = {
            proprietario: getVal(':ot2'),
            renavam: getVal(':ot6'),
            placa: getVal(':ot8'),
            modelo: getVal(':ot10'),
            ano: getVal(':ot12'),
            debitos: []
        };

        // Captura financeira
        $res('span').each((i, el) => {
            const t = $(el).text();
            if (t.includes('R$')) dados.debitos.push(t.replace(/CDATA\[|\]\]/g, '').trim());
        });

        // --- DIAGNÓSTICO DE ERRO ---
        if (!dados.proprietario) {
            // AQUI ESTÁ O SEGREDOS: Devolvemos os IDs que achamos para você me contar
            return res.status(404).json({
                erro: 'Não encontrei dados.',
                pista: `Tentei clicar em: ${idBotao}. Input usado: ${idInput}. Botões que vi na página: ${listaBotoesEncontrados.join(', ')}`
            });
        }

        res.json(dados);

    } catch (e) {
        res.status(500).json({ erro: 'Erro interno: ' + e.message });
    }
};

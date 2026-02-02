/* ARQUIVO: api/consulta.js (VERSÃO REVELADORA) */
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

        // 2. SONDA DE BOTOES (Modo Detetive)
        let idInput = $('label').filter((i, el) => $(el).text().includes('Renavam')).attr('for');
        if (!idInput) idInput = 'pt1:r1:0:it1'; 

        let listaBotoes = [];
        let idBotaoConsultar = '';

        // Varre TUDO que pode ser botão
        $('*').each((i, el) => {
            const id = $(el).attr('id');
            const texto = $(el).text() ? $(el).text().trim().substring(0, 20) : ''; // Pega só o começo do texto
            
            // Se tiver ID e parecer um botão ou link
            if (id && (el.tagName === 'button' || el.tagName === 'a' || $(el).attr('role') === 'button' || $(el).attr('class')?.includes('btn'))) {
                // Guarda na lista para te mostrar
                if (texto) listaBotoes.push(`[${id} = ${texto}]`);
                
                // Tenta achar o certo
                if (texto.toLowerCase().includes('consultar') || texto.toLowerCase().includes('pesquisar')) {
                    idBotaoConsultar = id;
                }
            }
        });

        // Se não achou pelo nome, tenta o padrão
        if (!idBotaoConsultar) idBotaoConsultar = 'pt1:r1:0:cb1';

        // 3. Tenta consultar
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'event': idBotaoConsultar, 
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

        // 4. Verifica o resultado
        const $res = cheerio.load(result.data);
        const proprietario = $res(`[id$=":ot2"]`).text().replace(/CDATA\[|\]\]/g, '').trim();

        // SE FALHAR, MOSTRA O MAPA DO TESOURO
        if (!proprietario) {
            // Aqui eu coloco a lista DENTRO da mensagem de erro para aparecer no seu pop-up
            return res.status(404).json({
                erro: `ERRO DE CLIQUE! ME ENVIE ISSO: Botão tentado: ${idBotaoConsultar}. Botoes na tela: ${listaBotoes.join(' | ')}`
            });
        }

        // Se der certo (milagre), retorna os dados
        const dados = {
            proprietario: proprietario,
            renavam: $res(`[id$=":ot6"]`).text().replace(/CDATA\[|\]\]/g, '').trim(),
            placa: $res(`[id$=":ot8"]`).text().replace(/CDATA\[|\]\]/g, '').trim(),
            modelo: $res(`[id$=":ot10"]`).text().replace(/CDATA\[|\]\]/g, '').trim(),
            ano: $res(`[id$=":ot12"]`).text().replace(/CDATA\[|\]\]/g, '').trim(),
            debitos: []
        };
        
        $res('span').each((i, el) => {
            const t = $(el).text();
            if (t.includes('R$')) dados.debitos.push(t.replace(/CDATA\[|\]\]/g, '').trim());
        });

        res.json(dados);

    } catch (e) {
        res.status(500).json({ erro: 'Erro Crítico: ' + e.message });
    }
};

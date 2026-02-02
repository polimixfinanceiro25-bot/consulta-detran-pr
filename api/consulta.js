/* ARQUIVO: api/consulta.js (VERSÃO COM OLHOS - DEBUG TEXTUAL) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');
// Importa o suporte a cookies para não perder a sessão no redirect
// (Se der erro de módulo, vamos usar gestão manual melhorada abaixo)

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { renavam } = req.body;
    if (!renavam) return res.status(400).json({ erro: 'Renavam vazio.' });

    try {
        const urlHome = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/home';
        
        // CUIDADO: Axios nativo perde cookies em redirects. Vamos tratar isso.
        const client = axios.create({
            maxRedirects: 0, // Nós mesmos vamos seguir os redirects para segurar o cookie
            validateStatus: status => status >= 200 && status < 400
        });

        // 1. Acessa Home
        const page = await client.get(urlHome);
        let cookies = page.headers['set-cookie'] || [];
        let cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

        const $ = cheerio.load(page.data);
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // SEUS IDs DESCOBERTOS (Corretos)
        const idInput = 'pt1:r1:0:r2:0:ig1:it1';
        const idBotao = 'pt1:r1:0:r2:0:ig1:b1';

        // 2. Monta o envio
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'source': idBotao,
            'event': idBotao,
            [idInput]: renavam
        };

        // 3. Dispara o POST
        const result = await client.post(urlHome, qs.stringify(form), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieStr, // Envia o crachá
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlHome
            }
        });

        // 4. Análise do Resultado (Onde o robô caiu?)
        const $res = cheerio.load(result.data);
        const proprietario = $res('[id$=":ot2"]').text();

        // === AQUI ESTÁ A MÁGICA DOS "OLHOS" ===
        if (!proprietario) {
            // Pega o título e os textos principais da página para saber onde estamos
            const titulo = $res('title').text().trim();
            const h1 = $res('h1').text().trim();
            const mensagensErro = $res('.AFError, .AFWarning, .ui-messages-error-detail').text().trim();
            
            // Pega um resumo do texto da página (primeiros 300 caracteres úteis)
            const corpoTexto = $res('body').text().replace(/\s+/g, ' ').substring(0, 300);

            return res.status(404).json({
                erro: 'Não encontrei o veículo.',
                olhos_do_robo: {
                    titulo_pagina: titulo,
                    mensagem_erro_site: mensagensErro || 'Nenhuma mensagem de erro explícita',
                    onde_estou: corpoTexto,
                    ids_usados: `Botão: ${idBotao} | Input: ${idInput}`
                }
            });
        }

        // Se achou, sucesso!
        const dados = {
            proprietario: proprietario,
            renavam: $res('[id$=":ot6"]').text(),
            placa: $res('[id$=":ot8"]').text(),
            modelo: $res('[id$=":ot10"]').text(),
            ano: $res('[id$=":ot12"]').text(),
            debitos: []
        };
        
        $res('span').each((i, el) => {
            const t = $(el).text();
            if (t.includes('R$')) dados.debitos.push(t.replace(/CDATA\[|\]\]/g, '').trim());
        });

        res.json(dados);

    } catch (e) {
        res.status(500).json({ erro: 'Erro técnico: ' + e.message });
    }
};

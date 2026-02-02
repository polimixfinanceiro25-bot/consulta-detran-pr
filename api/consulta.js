/* ARQUIVO: api/consulta.js (VERSÃO SNIPER - IDs PRECISOS) */
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
        const urlAlvo = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces/consultar-debitos-detalhes';

        // --- FASE 1: Reconhecimento (GET) ---
        const page = await axios.get(urlAlvo);
        const html = page.data;
        
        // Pega Cookies (Crachá)
        const cookies = page.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';

        // Pega ViewState (Mapa da sessão)
        const $ = cheerio.load(html);
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // --- TÉCNICA SNIPER: Achar os IDs exatos ---
        // Procuramos no HTML bruto onde está escrito "Consultar" e pegamos o ID do botão pai
        // Exemplo no HTML: <button id="pt1:r1:0:cb1">Consultar</button>
        let idBotao = '';
        const regexBotao = /id="([^"]+)"[^>]*>[^<]*Consultar/i;
        const matchBotao = html.match(regexBotao);
        
        if (matchBotao) {
            idBotao = matchBotao[1]; // Achou o ID exato!
        } else {
            // Se não achar, tenta os IDs comuns do Detran-PR que mudam pouco
            idBotao = 'pt1:r1:0:cb1'; // Chute educado 1
            if (html.includes('pt1:r1:0:b2')) idBotao = 'pt1:r1:0:b2'; // Chute educado 2
        }

        // Procura o ID do campo Renavam (Input)
        // Geralmente está perto do Label "Renavam"
        let idInputRenavam = 'pt1:r1:0:it1'; // Padrão mais comum
        // Tenta achar labels 'for="X"'
        const regexLabel = /for="([^"]+)"[^>]*>\s*\*? ?Renavam/i;
        const matchLabel = html.match(regexLabel);
        if (matchLabel) idInputRenavam = matchLabel[1];

        // --- FASE 2: O Disparo (POST) ---
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'event': idBotao, // O segredo está aqui: clicar no botão certo
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

        // --- FASE 3: A Coleta (Parser) ---
        const $res = cheerio.load(result.data);
        const rawText = $res.text(); // Texto puro da página de resposta

        // Verifica se continuamos na página de pesquisa (Erro de clique)
        if (rawText.includes('Consultar Débitos e Guias')) {
             // Se a página de resposta ainda tem o título de busca, o clique falhou.
             // Mas vamos tentar ler mesmo assim, vai que os dados apareceram embaixo.
        }

        // Função para pescar dados específicos
        const extrair = (idParcial) => {
            // Procura elementos que terminam com o ID (ex: :ot2)
            const el = $res(`[id$="${idParcial}"]`); 
            return el.length ? el.text().trim() : '';
        };

        // Dados baseados nos seus prints (ot2=Proprietario, ot6=Renavam, ot8=Placa)
        const dados = {
            proprietario: extrair(':ot2'),
            renavam: extrair(':ot6'),
            placa: extrair(':ot8'),
            modelo: extrair(':ot10'),
            ano: extrair(':ot12'),
            debitos: []
        };

        // Captura de valores (R$)
        $res('span').each((i, el) => {
            const txt = $(el).text();
            if (txt.includes('R$')) dados.debitos.push(txt);
        });

        // --- TRAVA DE SEGURANÇA FINAL ---
        // Se não achou proprietário, é porque falhou
        if (!dados.proprietario || dados.proprietario === '') {
            return res.status(404).json({ 
                erro: 'Veículo não encontrado.',
                debug: `Botão usado: ${idBotao}, Input usado: ${idInputRenavam}`
            });
        }

        res.json(dados);

    } catch (e) {
        res.status(500).json({ erro: 'Erro interno.' });
    }
};

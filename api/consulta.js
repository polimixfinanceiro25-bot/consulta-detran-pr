/* ARQUIVO: api/consulta.js (VERSÃO ROBUSTA - LEITURA INTELIGENTE) */
const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');

module.exports = async (req, res) => {
    // Headers de segurança para permitir o acesso do seu site
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { renavam } = req.body;

    if (!renavam) {
        return res.status(400).json({ erro: 'Renavam vazio.' });
    }

    try {
        const urlBase = 'https://www.contribuinte.fazenda.pr.gov.br/ipva/faces';
        const urlAlvo = `${urlBase}/consultar-debitos-detalhes`;

        // 1. Acessa a página inicial para iniciar a sessão
        const responsePagina = await axios.get(urlAlvo);
        
        // Pega os cookies de sessão
        const cookies = responsePagina.headers['set-cookie'];
        const cookieHeader = cookies ? cookies.map(c => c.split(';')[0]).join('; ') : '';

        // Carrega o HTML para achar os botões
        const $ = cheerio.load(responsePagina.data);
        const viewState = $('input[name="javax.faces.ViewState"]').val();

        // Tenta achar o ID do botão de Consultar
        // Procura por qualquer botão que tenha texto "Consultar" ou similar
        let idBotao = '';
        $('button, a').each((i, el) => {
            const txt = $(el).text().toLowerCase();
            if (txt.includes('consultar') || txt.includes('pesquisar')) {
                idBotao = $(el).attr('id');
            }
        });
        
        // Tenta achar o ID do campo Renavam
        let idCampo = '';
        $('label').each((i, el) => {
            if ($(el).text().includes('Renavam')) {
                idCampo = $(el).attr('for');
            }
        });

        // Fallbacks (se não achar, tenta os padrões conhecidos)
        if (!idBotao) idBotao = 'pt1:r1:0:b1';
        if (!idCampo) idCampo = 'pt1:r1:0:it1';

        // 2. Envia os dados (Simula o clique)
        const form = {
            'org.apache.myfaces.trinidad.faces.FORM': 'f1',
            'javax.faces.ViewState': viewState,
            'event': idBotao,
            [idCampo]: renavam
        };

        const responsePost = await axios.post(urlAlvo, qs.stringify(form), {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Cookie': cookieHeader,
                'Origin': 'https://www.contribuinte.fazenda.pr.gov.br',
                'Referer': urlAlvo
            }
        });

        // 3. LEITURA INTELIGENTE (SEM DEPENDER DE IDs)
        // Transformamos tudo em texto e procuramos os padrões visuais
        const corpoResposta = responsePost.data;
        const $res = cheerio.load(corpoResposta);
        const textoCompleto = $res.text(); // Pega todo o texto da página limpo

        // Função auxiliar para extrair dados usando "Labels" vizinhos
        // Procura o elemento que contem o Label e pega o próximo Span com valor
        const extrairPorLabel = (label) => {
            let valor = 'Não encontrado';
            // Procura spans que contenham o nome do campo (ex: "Proprietário")
            $res('span').each((i, el) => {
                if ($(el).text().includes(label)) {
                    // Tenta pegar o valor navegando na estrutura da tabela do Detran
                    // Geralmente: Label -> Pai -> Pai -> Próximo TD/Div -> Filho -> Span Valor
                    // Estrutura do XML: <td><div><span>Label</span></div></td> <td><div><span>VALOR</span></div></td>
                    const valorProvavel = $(el).parent().parent().parent().find('td').eq(1).find('span').text();
                    if (valorProvavel && valorProvavel.trim() !== '') {
                        valor = valorProvavel;
                    } else {
                         // Tentativa 2: Busca genérica por proximidade
                         const proximo = $(el).closest('td').next('td').text();
                         if(proximo) valor = proximo;
                    }
                }
            });
            // Limpeza final (remove CDATA e sujeira do XML)
            return valor.replace('CDATA[', '').replace(']]', '').trim();
        };

        // Extração Manual baseada no seu XML de exemplo
        // Se a busca inteligente falhar, tentamos regex direto no HTML bruto
        const extrairRegex = (texto, chave) => {
            // Procura algo como: <span ...>Proprietário</span> ... <span ...>NOME</span>
            // Essa regex é genérica para tentar achar o valor após o label
            try {
                const regex = new RegExp(`${chave}<\\/span>.*?<span.*?>(.*?)<\\/span>`, 's');
                const match = texto.match(regex);
                return match ? match[1].replace('CDATA[', '').replace(']]', '').trim() : '';
            } catch (e) { return ''; }
        };

        // Monta o objeto final misturando as técnicas
        const resultado = {
            proprietario: extrairPorLabel('Proprietário') || extrairRegex(corpoResposta, 'Proprietário'),
            renavam: extrairPorLabel('Renavam') || extrairRegex(corpoResposta, 'Renavam'),
            placa: extrairPorLabel('Placa') || extrairRegex(corpoResposta, 'Placa'),
            modelo: extrairPorLabel('Modelo') || extrairRegex(corpoResposta, 'Modelo'),
            ano: extrairPorLabel('Fabricação') || extrairRegex(corpoResposta, 'Fabricação'),
            debitos: []
        };

        // Busca valores financeiros (R$)
        // Varre todos os spans procurando cifrão
        $res('span').each((i, el) => {
            const t = $(el).text();
            if (t.includes('R$')) {
                resultado.debitos.push(t.replace('CDATA[', '').replace(']]', '').trim());
            }
        });

        // 4. TRAVA DE SEGURANÇA
        // Se mesmo com a leitura inteligente não acharmos o Proprietário ou a Placa,
        // então o Renavam realmente não existe ou o site bloqueou.
        if (!resultado.proprietario || resultado.proprietario === 'Não encontrado' || resultado.proprietario.length < 3) {
             return res.status(404).json({ 
                erro: 'Veículo não localizado. Confira o Renavam.' 
            });
        }

        res.json(resultado);

    } catch (e) {
        console.log(e);
        res.status(500).json({ erro: 'Erro interno ao consultar.' });
    }
};

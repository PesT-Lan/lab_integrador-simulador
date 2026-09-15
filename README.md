# Lab Integrador — Simulador de Engenharia de Tráfego

Simulador browser para demonstração do projeto integrador sobre engenharia de tráfego adjacente ao OSPF.

## Acesso

Após a execução do workflow de publicação, o simulador estará disponível em:

<https://pest-lan.github.io/lab_integrador-simulador/>

## O que demonstrar

A interface apresenta uma topologia Multi-AS com domínio local `AS65001`, dois egresses, dois trânsitos e um destino. É possível comparar o **OSPF baseline** com o **OSPF + agente**, selecionar um enlace e aplicar um pico sintético de `+20 ms` ou uma falha manual. RTT p95, perda de sondas e goodput são atualizados visualmente, e os eventos podem ser normalizados.

Os dados exibidos são **sintéticos e determinísticos**. Eles servem para explicar a metodologia, os SLOs e os guardrails durante a banca; não substituem a campanha empírica com Vagrant, FRR, `tc`, seeds e artefatos versionados do repositório privado principal.

## Desenvolvimento local

```bash
pnpm install
pnpm check
pnpm dev
```

Para gerar a versão de produção:

```bash
GITHUB_PAGES=true pnpm build
```

O workflow `.github/workflows/pages.yml` executa o check, gera o build e publica automaticamente cada alteração no `main`.

## Projeto completo

A implementação experimental, a infraestrutura Vagrant/FRR, o agente Python e a metodologia científica permanecem no repositório privado [PesT-Lan/lab_integrador](https://github.com/PesT-Lan/lab_integrador).

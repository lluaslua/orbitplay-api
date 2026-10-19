# Builds de exemplo

Para testar a etapa 3 do Novo teste sem uma build de verdade:

- `RachaDeRua-1.3.0-com-plugin.unity` — traz o manifesto do Orbit Plug-in (5 gatilhos e 2 mapas de calor). Serve para o modelo **Exploração livre + Telemetria**.
- `RachaDeRua-1.3.0-sem-plugin.exe` — build sem o plug-in, só Windows. Serve para **Exploração livre** e **Teste A/B**.

O manifesto fica entre os marcadores `<<ORBITPLAY_PLUGIN>>` e `<</ORBITPLAY_PLUGIN>>`, como o SDK grava.

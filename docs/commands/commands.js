function renderCommands(listId, commands) {
    const list = document.getElementById(listId);
    for (const command of commands) {
        const item = document.createElement('li');
        item.className = 'command-item';

        const name = document.createElement('span');
        name.className = 'command-name';
        name.textContent = command.usage || [
            `!${command.name}`,
            ...(command.aliases || []).map(alias => `!${alias}`)
        ].join(' · ');
        if (command.usage && command.aliases?.length) {
            name.textContent += ` · ${command.aliases.map(alias => `!${alias}`).join(' · ')}`;
        }
        item.appendChild(name);

        const description = document.createElement('span');
        description.className = 'command-description';
        description.textContent = command.description;
        item.appendChild(description);

        if (command.access) {
            const access = document.createElement('span');
            access.className = 'command-access';
            access.textContent = command.access;
            item.appendChild(access);
        }

        list.appendChild(item);
    }
}

async function loadCommandDirectory() {
    const status = document.getElementById('status');
    try {
        const response = await fetch('commands.json', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const directory = await response.json();

        renderCommands('twitch-only-commands', directory.twitchOnly);
        renderCommands('discord-slash-commands', directory.discordSlash);
        renderCommands('discord-only-commands', directory.discordOnly);
        renderCommands('both-commands', directory.both);
        document.getElementById('command-lists').hidden = false;
        status.hidden = true;
    } catch (error) {
        status.dataset.error = 'true';
        status.textContent = 'Could not load the command list. Please try again later.';
        console.error('Failed to load bot command directory:', error);
    }
}

loadCommandDirectory();

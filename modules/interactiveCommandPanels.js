const { randomUUID } = require('crypto');
const {
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  MentionableSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const SESSION_TTL = 15 * 60 * 1000;
const sessions = new Map();

function flattenActions(options, parentPath = []) {
  const actions = [];
  for (const option of options || []) {
    if (option.type === 2) {
      actions.push(...flattenActions(option.options, [...parentPath, option.name]));
    } else if (option.type === 1) {
      actions.push({
        path: [...parentPath, option.name],
        name: option.name,
        description: option.description,
        options: option.options || []
      });
    }
  }
  return actions;
}

function getAction(session) {
  return session.actions.find(action => action.path.join('/') === session.actionPath);
}

function buildActionPicker(session, message = '') {
  session.view = 'picker';
  if (session.actions.length > 25) {
    throw new Error(`/${session.name} has more than 25 actions; its interactive action menu needs pagination.`);
  }
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cmdpanel:action:${session.id}`)
    .setPlaceholder(`Choose a ${session.name} action`)
    .addOptions(session.actions.map(action => ({
      label: action.path.join(' / ').slice(0, 100),
      description: (action.description || 'Run this command action').slice(0, 100),
      value: action.path.join('/')
    })));

  return {
    content: [
      message,
      `**/${session.name}**`,
      'Choose what you want to do. The selected action will guide you through its options.'
    ].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(menu),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cmdpanel:back:${session.id}`)
          .setLabel('Back / Close')
          .setStyle(ButtonStyle.Secondary)
      )
    ]
  };
}

function buildFieldPanel(session, message = '', suggestions = []) {
  session.view = 'field';
  const action = getAction(session);
  const option = action.options[session.optionIndex];
  if (!option) return null;
  const savedValue = session.editDefaults?.[option.name];

  const requiredText = option.required ? 'Required' : 'Optional';
  const parts = [
    message,
    `**/${session.name} ${action.path.join(' ')}**`,
    `Step ${session.optionIndex + 1} of ${action.options.length}: **${option.name}** (${requiredText})`,
    option.description,
    savedValue === undefined || savedValue === null
      ? null
      : `Currently saved: ${formatSavedValue(option, savedValue)}`,
    option.autocomplete && suggestions.length
      ? 'Choose an existing match below, or enter a value.'
      : null,
    'Use the control below to enter or choose a value.'
  ].filter(Boolean);
  const rows = [];

  if (option.autocomplete && suggestions.length) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cmdpanel:suggestion:${session.id}`)
        .setPlaceholder(`Choose ${option.name}`)
        .addOptions(suggestions.slice(0, 25).map(suggestion => ({
          label: String(suggestion.name).slice(0, 100),
          value: String(suggestion.value).slice(0, 100)
        })))
    ));
  }

  if ((option.type === 3 || option.type === 4) && option.choices?.length && option.choices.length <= 25) {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`cmdpanel:value:${session.id}`)
      .setPlaceholder(`Choose ${option.name}`)
      .addOptions(option.choices.map(choice => ({
        label: choice.name.slice(0, 100),
        value: String(choice.value)
      })));
    rows.push(new ActionRowBuilder().addComponents(select));
  } else if (option.type === 5) {
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`cmdpanel:value:${session.id}`)
        .setPlaceholder(`Choose ${option.name}`)
        .addOptions(
          { label: 'Yes', value: 'true', default: savedValue === true },
          { label: 'No', value: 'false', default: savedValue === false }
        )
    ));
  } else if (option.type === 6) {
    const select = new UserSelectMenuBuilder()
        .setCustomId(`cmdpanel:value:${session.id}`)
        .setPlaceholder(`Choose ${option.name}`)
        .setMinValues(1)
        .setMaxValues(1);
    if (/^\d{15,25}$/.test(String(savedValue ?? ''))) select.setDefaultUsers(String(savedValue));
    rows.push(new ActionRowBuilder().addComponents(select));
  } else if (option.type === 7) {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(`cmdpanel:value:${session.id}`)
      .setPlaceholder(`Choose ${option.name}`)
      .setMinValues(1)
      .setMaxValues(1);
    if (option.channel_types?.length) select.addChannelTypes(...option.channel_types);
    if (/^\d{15,25}$/.test(String(savedValue ?? ''))) select.setDefaultChannels(String(savedValue));
    rows.push(new ActionRowBuilder().addComponents(select));
  } else if (option.type === 8 || (option.type === 3 && /role/i.test(option.name) && /role/i.test(option.description || ''))) {
    const select = new RoleSelectMenuBuilder()
        .setCustomId(`cmdpanel:value:${session.id}`)
        .setPlaceholder(`Choose ${option.name}`)
        .setMinValues(1)
        .setMaxValues(option.type === 3 ? 25 : 1);
    const savedRoles = Array.isArray(savedValue)
      ? savedValue.map(String).filter(roleId => /^\d{15,25}$/.test(roleId)).slice(0, 25)
      : [];
    if (savedRoles.length) select.setDefaultRoles(...savedRoles);
    rows.push(new ActionRowBuilder().addComponents(select));
  } else if (option.type === 9) {
    rows.push(new ActionRowBuilder().addComponents(
      new MentionableSelectMenuBuilder()
        .setCustomId(`cmdpanel:value:${session.id}`)
        .setPlaceholder(`Choose ${option.name}`)
        .setMinValues(1)
        .setMaxValues(1)
    ));
  } else {
    const label = option.type === 11 ? `${option.name} URL` : option.name;
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cmdpanel:input:${session.id}`)
        .setLabel(`Enter ${label}`.slice(0, 80))
        .setStyle(ButtonStyle.Primary)
    ));
    if (option.type === 11) parts.push('For image/file options, paste a publicly accessible URL.');
  }

  const buttons = [];
  if (option.type === 6) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`cmdpanel:input:${session.id}`)
      .setLabel('Enter user ID')
      .setStyle(ButtonStyle.Secondary));
  }
  if (!option.required) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`cmdpanel:skip:${session.id}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary));
  }
  buttons.push(new ButtonBuilder()
    .setCustomId(`cmdpanel:back:${session.id}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder()
    .setCustomId(`cmdpanel:cancel:${session.id}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger));
  rows.push(new ActionRowBuilder().addComponents(...buttons));

  return { content: parts.join('\n'), components: rows };
}

function formatSavedValue(option, value) {
  if (option.type === 5) return value ? 'Yes' : 'No';
  if (option.type === 7) return `<#${value}>`;
  if (option.type === 6 && /^\d{15,25}$/.test(String(value))) return `<@${value}>`;
  if (Array.isArray(value)) return value.length ? value.map(id => `<@&${id}>`).join(', ') : '(none)';
  const text = String(value).replace(/\s+/g, ' ').slice(0, 300);
  return text || '(empty)';
}

function buildAutocompletePanel(session, option, suggestions) {
  session.view = 'autocomplete';
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`cmdpanel:suggestion:${session.id}`)
    .setPlaceholder(`Choose a match for ${option.name}`)
    .addOptions(suggestions.slice(0, 25).map(suggestion => ({
      label: String(suggestion.name).slice(0, 100),
      value: String(suggestion.value).slice(0, 100)
    })));
  const rows = [new ActionRowBuilder().addComponents(menu)];
  const buttons = [
    new ButtonBuilder()
      .setCustomId(`cmdpanel:typed:${session.id}`)
      .setLabel(`Use "${session.pendingValue.slice(0, 55)}"`)
      .setStyle(ButtonStyle.Primary)
  ];
  if (!option.required) {
    buttons.push(new ButtonBuilder()
      .setCustomId(`cmdpanel:skip:${session.id}`)
      .setLabel('Skip')
      .setStyle(ButtonStyle.Secondary));
  }
  buttons.push(new ButtonBuilder()
    .setCustomId(`cmdpanel:back:${session.id}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary));
  buttons.push(new ButtonBuilder()
    .setCustomId(`cmdpanel:cancel:${session.id}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger));
  rows.push(new ActionRowBuilder().addComponents(...buttons));
  return {
    content: [
      `**/${session.name} ${getAction(session).path.join(' ')}**`,
      `Choose a suggestion for **${option.name}**, or use the value you entered: \`${session.pendingValue}\`.`
    ].join('\n'),
    components: rows
  };
}

function buildReviewPanel(session) {
  session.view = 'review';
  const action = getAction(session);
  const summary = action.options.length
    ? action.options.map(option => {
      const value = session.values[option.name];
      if (value == null) return `• **${option.name}:** Skipped`;
      if (option.type === 5) return `• **${option.name}:** ${value ? 'Yes' : 'No'}`;
      if (option.type === 6) return `• **${option.name}:** <@${value}>`;
      if (option.type === 7) return `• **${option.name}:** <#${value}>`;
      if (option.type === 8) return `• **${option.name}:** <@&${value}>`;
      if (option.type === 11) return `• **${option.name}:** ${value}`;
      return `• **${option.name}:** ${String(value).slice(0, 500)}`;
    }).join('\n')
    : 'This action has no additional options.';
  return {
    content: [
      `**Review: /${session.name} ${action.path.join(' ')}**`,
      summary,
      'Go back to edit the previous option, confirm to run this action, or close to exit.'
    ].join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`cmdpanel:run:${session.id}`)
          .setLabel('Confirm and run')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`cmdpanel:back:${session.id}`)
          .setLabel('Back')
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(`cmdpanel:cancel:${session.id}`)
          .setLabel('Close')
          .setStyle(ButtonStyle.Danger)
      )
    ]
  };
}

function createOptionsProxy(session, interaction) {
  const values = session.values;
  const action = getAction(session);
  const optionByName = new Map(action.options.map(option => [option.name, option]));
  const resolve = (name, acceptedTypes) => {
    const option = optionByName.get(name);
    if (!option || !acceptedTypes.includes(option.type)) {
      throw new TypeError(`/${session.name} ${action.path.join(' ')} does not define a compatible "${name}" option.`);
    }
    return values[name] ?? null;
  };

  return {
    getSubcommand: () => action.path.at(-1),
    getSubcommandGroup: () => action.path.length > 1 ? action.path.at(-2) : null,
    getString: name => resolve(name, [3]),
    getInteger: name => resolve(name, [4]),
    getBoolean: name => resolve(name, [5]),
    getUser: name => resolve(name, [6]),
    getChannel: name => resolve(name, [7]),
    getRole: name => resolve(name, [8]),
    getMentionable: name => resolve(name, [6, 8]),
    getNumber: name => resolve(name, [10]),
    getAttachment: name => resolve(name, [11]),
    getMember: name => {
      if (!optionByName.has(name)) {
        throw new TypeError(`/${session.name} ${action.path.join(' ')} does not define a "${name}" option.`);
      }
      return null;
    }
  };
}

function toAttachment(url) {
  return {
    url,
    proxyURL: url,
    name: url.split('/').pop().split('?')[0] || 'attachment',
    contentType: null,
    size: 0
  };
}

async function resolveValues(session, interaction) {
  const action = getAction(session);
  for (const option of action.options) {
    const value = session.values[option.name];
    if (value == null) continue;
    if (option.type === 6) {
      let member = interaction.guild.members.cache.get(value);
      if (!member) {
        try {
          member = await interaction.guild.members.fetch(value);
        } catch (error) {
          if (error.code !== 10007) throw error;
          session.values[option.name] = interaction.users?.get?.(value) ||
            await interaction.client.users.fetch(value);
          continue;
        }
      }
      session.values[option.name] = member.user;
      session.members[option.name] = member;
    } else if (option.type === 7) {
      session.values[option.name] = interaction.guild.channels.cache.get(value) ||
        await interaction.guild.channels.fetch(value);
    } else if (option.type === 8) {
      session.values[option.name] = interaction.guild.roles.cache.get(value) ||
        await interaction.guild.roles.fetch(value);
    } else if (option.type === 9) {
      const role = interaction.roles?.get?.(value) ||
        interaction.roles?.cache?.get?.(value) ||
        interaction.guild.roles.cache.get(value);
      if (role) session.values[option.name] = role;
      else {
        const selectedUser = interaction.users?.get?.(value);
        const selectedMember = interaction.members?.get?.(value);
        const member = selectedMember || await interaction.guild.members.fetch(value);
        session.values[option.name] = member.user;
        session.members[option.name] = member;
        if (selectedUser) session.values[option.name] = selectedUser;
      }
    } else if (option.type === 11) {
      session.values[option.name] = toAttachment(value);
    }
  }
}

async function runAction(session, interaction) {
  const action = getAction(session);
  for (const option of action.options) {
    if (option.required && session.values[option.name] == null) {
      throw new Error(`Required option "${option.name}" was not provided.`);
    }
  }
  await resolveValues(session, interaction);
  clearTimeout(session.timeout);
  sessions.delete(session.id);

  const optionValues = createOptionsProxy(session, interaction);
  const options = new Proxy(optionValues, {
    get(target, property) {
      if (property === 'getMember') {
        return name => {
          const member = session.members[name];
          if (member) return member;
          const user = target.getUser(name);
          return user ? interaction.guild.members.cache.get(user.id) || null : null;
        };
      }
      return target[property];
    }
  });
  const proxiedInteraction = new Proxy(interaction, {
    get(target, property) {
      if (property === 'options') return options;
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    }
  });
  return session.execute(proxiedInteraction, session.client);
}

async function getAutocompleteSuggestions(session, interaction, option, value = '') {
  if (!option.autocomplete || !session.command.autocomplete) return [];

  let suggestions = [];
  await session.command.autocomplete({
    client: session.client,
    guildId: interaction.guildId,
    options: {
      getFocused: () => ({ name: option.name, value }),
      getSubcommand: () => getAction(session).path.at(-1),
      getSubcommandGroup: () => getAction(session).path.length > 1
        ? getAction(session).path.at(-2)
        : null
    },
    respond: async choices => { suggestions = choices; }
  });
  return suggestions;
}

async function loadEditDefaults(session, interaction, option, value) {
  const action = getAction(session);
  if (option.name !== 'username' ||
      action.path.at(-1) !== 'edit' ||
      !session.command.getEditDefaults) return;

  session.editDefaults = await session.command.getEditDefaults({
    client: session.client,
    guildId: interaction.guildId,
    target: value,
    actionPath: action.path
  });
}

async function showField(session, interaction, message = '') {
  const action = getAction(session);
  const option = action.options[session.optionIndex];
  const suggestions = await getAutocompleteSuggestions(session, interaction, option);
  return interaction.update(buildFieldPanel(session, message, suggestions));
}

async function beginAction(session, actionPath, interaction) {
  session.actionPath = actionPath;
  session.optionIndex = 0;
  session.values = {};
  session.members = {};
  session.editDefaults = null;
  const action = getAction(session);
  if (!action.options.length) {
    if (action.name === 'panel' && action.path.length === 1) return runAction(session, interaction);
    return interaction.update(buildReviewPanel(session));
  }
  return showField(session, interaction);
}

async function showNext(session, interaction) {
  session.optionIndex += 1;
  const action = getAction(session);
  if (session.optionIndex >= action.options.length) return interaction.update(buildReviewPanel(session));
  return showField(session, interaction);
}

async function handleComponentInternal(interaction) {
  const [, action, sessionId] = interaction.customId.split(':');
  const session = sessions.get(sessionId);
  if (!session || session.guildId !== interaction.guildId) {
    return interaction.reply({ content: 'This command panel expired. Run the command again.', flags: MessageFlags.Ephemeral });
  }
  if (session.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Only the person who opened this panel can use it.', flags: MessageFlags.Ephemeral });
  }
  if (session.defaultPermissions &&
      !interaction.memberPermissions?.has(BigInt(session.defaultPermissions))) {
    return interaction.reply({ content: 'You no longer have permission to use this command.', flags: MessageFlags.Ephemeral });
  }
  if (action === 'action') {
    return beginAction(session, interaction.values[0], interaction);
  }
  if (action === 'cancel') {
    clearTimeout(session.timeout);
    sessions.delete(session.id);
    return interaction.update({ content: 'Command interaction cancelled.', components: [] });
  }
  if (action === 'back') {
    if (session.view === 'picker') {
      clearTimeout(session.timeout);
      sessions.delete(session.id);
      return interaction.update({ content: 'Command panel closed.', components: [] });
    }
    if (session.view === 'review') {
      const selectedAction = getAction(session);
      if (!selectedAction.options.length) {
        session.actionPath = null;
        return interaction.update(buildActionPicker(session));
      }
      session.optionIndex = Math.max(0, selectedAction.options.length - 1);
      return showField(session, interaction);
    }
    if (session.view === 'autocomplete') {
      session.pendingValue = null;
      return showField(session, interaction);
    }
    if (session.view === 'field' && session.optionIndex > 0) {
      session.optionIndex -= 1;
      return showField(session, interaction);
    }
    session.actionPath = null;
    session.optionIndex = 0;
    return interaction.update(buildActionPicker(session));
  }
  if (action === 'run') return runAction(session, interaction);
  if (action === 'skip') return showNext(session, interaction);
  if (action === 'suggestion') {
    const option = getAction(session).options[session.optionIndex];
    session.values[option.name] = interaction.values[0];
    await loadEditDefaults(session, interaction, option, interaction.values[0]);
    session.pendingValue = null;
    return showNext(session, interaction);
  }
  if (action === 'typed') {
    const option = getAction(session).options[session.optionIndex];
    session.values[option.name] = session.pendingValue;
    await loadEditDefaults(session, interaction, option, session.pendingValue);
    session.pendingValue = null;
    return showNext(session, interaction);
  }
  if (action === 'input') {
    const option = getAction(session).options[session.optionIndex];
    const userIdInput = option.type === 6;
    const input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel((userIdInput ? 'Discord user ID' : option.type === 11 ? `${option.name} URL` : option.name).slice(0, 45))
      .setStyle(!userIdInput && option.type === 3 && (option.max_length || 0) > 500 ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(userIdInput || option.required);
    if (userIdInput) {
      input.setPlaceholder('Enter a Discord user ID');
    } else if (option.description) {
      input.setPlaceholder(option.description.slice(0, 100));
    }
    if (option.type === 3) {
      input.setMaxLength(Math.min(option.max_length || 4000, 4000));
      if (option.min_length) input.setMinLength(option.min_length);
      if (typeof session.editDefaults?.[option.name] === 'string' &&
          session.editDefaults[option.name].length > 0 &&
          session.editDefaults[option.name].length <= Math.min(option.max_length || 4000, 4000)) {
        input.setValue(session.editDefaults[option.name]);
      }
    } else {
      input.setMaxLength(100);
      if (session.editDefaults?.[option.name] != null) {
        input.setValue(String(session.editDefaults[option.name]));
      }
      if (!userIdInput) input.setPlaceholder(option.type === 11 ? 'https://example.com/image.png' : 'Enter a number');
    }
    const modal = new ModalBuilder()
      .setCustomId(`cmdpanel:modal:${session.id}`)
      .setTitle(`Enter ${option.name}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
  }
  if (action === 'value') {
    const option = getAction(session).options[session.optionIndex];
    if (option.type === 3 && /role/i.test(option.name) && /role/i.test(option.description || '')) {
      session.values[option.name] = interaction.values.map(id => `<@&${id}>`).join(', ');
      return showNext(session, interaction);
    }
    const value = interaction.values[0];
    if (option.type === 5) session.values[option.name] = value === 'true';
    else if (option.type === 4) session.values[option.name] = Number.parseInt(value, 10);
    else if (option.type === 10) session.values[option.name] = Number(value);
    else session.values[option.name] = value;
    return showNext(session, interaction);
  }
  return interaction.reply({ content: 'This command action is not recognized.', flags: MessageFlags.Ephemeral });
}

async function handleModalInternal(interaction) {
  const [, , sessionId] = interaction.customId.split(':');
  const session = sessions.get(sessionId);
  if (!session || session.guildId !== interaction.guildId) {
    return interaction.reply({ content: 'This command panel expired. Run the command again.', flags: MessageFlags.Ephemeral });
  }
  if (session.userId !== interaction.user.id) {
    return interaction.reply({ content: 'Only the person who opened this panel can use it.', flags: MessageFlags.Ephemeral });
  }
  if (session.defaultPermissions &&
      !interaction.memberPermissions?.has(BigInt(session.defaultPermissions))) {
    return interaction.reply({ content: 'You no longer have permission to use this command.', flags: MessageFlags.Ephemeral });
  }
  const option = getAction(session).options[session.optionIndex];
  const rawValue = interaction.fields.getTextInputValue('value').trim();
  if (option.type === 4 || option.type === 10) {
    const value = option.type === 4 && /^-?\d+$/.test(rawValue)
      ? Number.parseInt(rawValue, 10)
      : option.type === 10 ? Number(rawValue) : NaN;
    if (!Number.isFinite(value) ||
        (option.min_value != null && value < option.min_value) ||
        (option.max_value != null && value > option.max_value)) {
      return interaction.reply({
        content: `Enter a valid ${option.type === 4 ? 'integer' : 'number'}${option.min_value != null || option.max_value != null ? ` between ${option.min_value ?? 'the minimum'} and ${option.max_value ?? 'the maximum'}` : ''}.`,
        flags: MessageFlags.Ephemeral
      });
    }
    session.values[option.name] = value;
  } else {
    if (!rawValue && option.required) {
      return interaction.reply({ content: 'This field is required.', flags: MessageFlags.Ephemeral });
    }
    if (option.type === 6 && rawValue && !/^\d{15,25}$/.test(rawValue.replace(/[<@!>]/g, ''))) {
      return interaction.reply({ content: 'Enter a valid Discord user ID.', flags: MessageFlags.Ephemeral });
    }
    if (option.type === 3 && option.min_length && rawValue.length < option.min_length) {
      return interaction.reply({ content: `Enter at least ${option.min_length} characters.`, flags: MessageFlags.Ephemeral });
    }
    if (option.type === 3 && option.max_length && rawValue.length > option.max_length) {
      return interaction.reply({ content: `Enter no more than ${option.max_length} characters.`, flags: MessageFlags.Ephemeral });
    }
    session.values[option.name] = option.type === 6
      ? rawValue.replace(/[<@!>]/g, '') || null
      : rawValue;
    if (option.autocomplete && rawValue && session.command.autocomplete) {
      try {
        const suggestions = await getAutocompleteSuggestions(session, interaction, option, rawValue);
        if (suggestions.length) {
          session.pendingValue = rawValue;
          return interaction.update(buildAutocompletePanel(session, option, suggestions));
        }
        await loadEditDefaults(session, interaction, option, rawValue);
      } catch (error) {
        console.error(`Interactive autocomplete failed for /${session.name}:`, error);
        return interaction.reply({
          content: 'Could not load suggestions for this value. Please try again.',
          flags: MessageFlags.Ephemeral
        });
      }
    }
  }
  return showNext(session, interaction);
}

async function handleComponent(interaction) {
  try {
    return await handleComponentInternal(interaction);
  } catch (error) {
    console.error('Interactive command component failed:', error);
    const response = { content: '❌ Could not complete this command action. Please try again.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.followUp(response);
    return interaction.reply(response);
  }
}

async function handleModal(interaction) {
  try {
    return await handleModalInternal(interaction);
  } catch (error) {
    console.error('Interactive command modal failed:', error);
    const response = { content: '❌ Could not complete this command action. Please try again.', flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) return interaction.followUp(response);
    return interaction.reply(response);
  }
}

async function openCommand(interaction, command, source, client) {
  if (!interaction.inGuild() && source.default_member_permissions) {
    return interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
  }
  const actions = flattenActions(source.options);
  if (actions.length > 25) {
    return interaction.reply({
      content: `/${source.name} has too many actions for one interactive menu. Please contact the bot administrator.`,
      flags: MessageFlags.Ephemeral
    });
  }
  const panelAction = actions.find(action => action.path.length === 1 && action.name === 'panel');
  const session = {
    id: randomUUID(),
    name: source.name,
    guildId: interaction.guildId,
    userId: interaction.user.id,
    actions,
    actionPath: null,
    optionIndex: 0,
    values: {},
    members: {},
    command,
    execute: command._originalExecute.bind(command),
    client,
    defaultPermissions: source.default_member_permissions || null
  };
  session.timeout = setTimeout(() => sessions.delete(session.id), SESSION_TTL);
  session.timeout.unref?.();
  sessions.set(session.id, session);
  if (panelAction && !panelAction.options.length) {
    return beginAction(session, panelAction.path.join('/'), interaction);
  }
  return interaction.reply({ ...buildActionPicker(session), flags: MessageFlags.Ephemeral });
}

function prepareCommand(command) {
  const source = command.data.toJSON();
  if (!source.options?.some(option => option.type === 1 || option.type === 2)) return command;
  command.interactiveSource = source;
  command._originalExecute = command.execute;
  command.data.options.splice(0);
  command.execute = (interaction, client) => openCommand(interaction, command, source, client);
  return command;
}

module.exports = { prepareCommand, handleComponent, handleModal };

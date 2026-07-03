function injectPanelHtml() {
  if ($('#oso-toggle-btn').length) return;

  // Floating toggle button — always visible if the extension loaded at all.
  const toggleBtn = `<div id="oso-toggle-btn" title="OSO Sense Tracker">🎲</div>`;

  // Modal overlay + panel, hidden by default.
  const modal = `
    <div id="oso-modal-overlay">
      <div id="oso-modal">
        <div id="oso-modal-header">
          <span>OSO Sense Tracker</span>
          <span id="oso-modal-close">&times;</span>
        </div>
        <div id="oso-panel"></div>
        <div id="oso-dice-log"></div>
      </div>
    </div>
  `;

  $('body').append(toggleBtn).append(modal);

  $('#oso-toggle-btn').on('click', () => {
    $('#oso-modal-overlay').css('display', 'flex');
    renderPanel();
  });
  $('#oso-modal-close, #oso-modal-overlay').on('click', (e) => {
    if (e.target.id === 'oso-modal-close' || e.target.id === 'oso-modal-overlay') {
      $('#oso-modal-overlay').css('display', 'none');
    }
  });
}

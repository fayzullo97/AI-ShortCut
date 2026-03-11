document.addEventListener('DOMContentLoaded', () => {
    // Tabs Navigation
    const tabs = document.querySelectorAll('.nav li');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.getAttribute('data-tab');
            document.getElementById(targetId).classList.add('active');

            if (targetId === 'tab-main') loadStats();
            if (targetId === 'tab-prompts') loadPrompts();
        });
    });

    // Load Data
    async function loadStats() {
        try {
            const res = await fetch('/api/stats');
            const data = await res.json();

            if (data.success) {
                // Analytics Cards
                document.getElementById('val-active').textContent = data.stats.activeUsers || 0;
                document.getElementById('val-total-users').textContent = data.stats.activeUsers || 0;

                document.getElementById('val-gens').textContent = data.stats.totalGenerations || 0;
                document.getElementById('val-success').textContent = data.stats.successGenerations || 0;

                const failedGens = (data.stats.totalGenerations || 0) - (data.stats.successGenerations || 0);
                document.getElementById('val-failed').textContent = failedGens;

                const estCost = data.stats.estCost || 0;
                document.getElementById('val-cost').textContent = `$${estCost.toFixed(3)}`;

                // User List Table
                const tbody = document.getElementById('user-table-body');
                tbody.innerHTML = '';
                data.users.forEach(user => {
                    const name = user.first_name || 'Unknown';
                    const handle = user.username ? `@${user.username}` : '@Unknown';
                    const gens = user.generated || 0;
                    const userCost = user.est_cost || 0;

                    tbody.innerHTML += `
            <tr class="user-row">
              <td>${user.chat_id}</td>
              <td>
                <strong>${name}</strong>
                <span>${handle}</span>
              </td>
              <td class="text-blue fw-bold">${gens}</td>
              <td>$${userCost.toFixed(3)}</td>
            </tr>
          `;
                });
            }
        } catch (err) {
            console.error('Failed to load stats:', err);
        }
    }

    async function loadPrompts() {
        try {
            const res = await fetch('/api/prompts');
            const data = await res.json();

            if (data.success) {
                const tbody = document.getElementById('prompts-table-body');
                tbody.innerHTML = '';
                data.prompts.forEach(p => {
                    const isActive = p.is_active === 1;
                    const statusBadge = isActive ? '<span class="badge badge-live">Active</span>' : '<span class="badge" style="background:#555;color:#ccc">Inactive</span>';
                    const toggleBtnText = isActive ? 'Deactivate' : 'Activate';

                    tbody.innerHTML += `
            <tr>
              <td><code>${p.id}</code></td>
              <td><span class="btn ${p.id.includes('fire') ? 'btn-primary' : 'btn-sm'}" style="pointer-events:none">${p.label}</span></td>
              <td style="max-width: 300px; opacity: 0.8; font-size: 13px;">${p.prompt}</td>
              <td>${statusBadge}</td>
              <td>
                <button class="btn btn-sm" style="background:var(--bg-hover);color:white;" onclick="editPrompt('${p.id}')">Edit</button>
                <button class="btn btn-sm" style="background:var(--bg-hover);color:white;" onclick="togglePrompt('${p.id}')">${toggleBtnText}</button>
                <button class="btn btn-sm" style="background:rgba(239, 68, 68, 0.2);color:#ef4444;" onclick="deletePrompt('${p.id}')">Delete</button>
              </td>
            </tr>
          `;
                });

                // Store for edit modal reference
                window._loadedPrompts = data.prompts;
            }
        } catch (err) {
            console.error('Failed to load prompts:', err);
        }
    }

    // Initial Load
    loadStats();

    // Modal Logic
    const modal = document.getElementById('prompt-modal');
    const btnOpen = document.getElementById('open-prompt-modal');
    const btnClose = document.getElementById('close-modal');
    const form = document.getElementById('form-prompt');

    let isEditingId = null;

    btnOpen.onclick = () => {
        isEditingId = null;
        document.getElementById('input-id').disabled = false;
        document.querySelector('.modal-header h2').textContent = 'Create New Prompt';
        form.reset();
        modal.style.display = 'block';
    };

    btnClose.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => {
        if (e.target == modal) modal.style.display = 'none';
    }

    // Global actions for onclick
    window.togglePrompt = async (id) => {
        try {
            await fetch('/api/prompts/' + id + '/toggle', { method: 'PATCH' });
            loadPrompts();
        } catch (e) { console.error(e); }
    };

    window.deletePrompt = async (id) => {
        if (confirm('Are you sure you want to delete prompt: ' + id + '?')) {
            try {
                await fetch('/api/prompts/' + id, { method: 'DELETE' });
                loadPrompts();
            } catch (e) { console.error(e); }
        }
    };

    window.editPrompt = (id) => {
        const p = window._loadedPrompts.find(x => x.id === id);
        if (!p) return;
        isEditingId = id;
        document.getElementById('input-id').value = p.id;
        document.getElementById('input-id').disabled = true; // cannot change id
        document.getElementById('input-label').value = p.label;
        document.getElementById('input-prompt').value = p.prompt;
        document.querySelector('.modal-header h2').textContent = 'Edit Prompt';
        modal.style.display = 'block';
    };

    form.onsubmit = async (e) => {
        e.preventDefault();
        const payload = {
            id: document.getElementById('input-id').value.trim(),
            label: document.getElementById('input-label').value.trim(),
            prompt: document.getElementById('input-prompt').value.trim(),
        };

        try {
            const url = isEditingId ? '/api/prompts/' + isEditingId : '/api/prompts';
            const method = isEditingId ? 'PUT' : 'POST';

            const res = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            const data = await res.json();

            if (data.success) {
                modal.style.display = 'none';
                form.reset();
                loadPrompts(); // Refresh table
            } else {
                alert('Error: ' + data.error);
            }
        } catch (err) {
            console.error('Failed to submit prompt:', err);
            alert('Internal error submitting prompt.');
        }
    };
});

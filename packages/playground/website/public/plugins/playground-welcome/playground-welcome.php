<?php
/**
 * Plugin Name: Playground Welcome
 * Description: A welcome dialog for WordPress Playground that lets you set your name and import RSS feed content.
 * Version: 1.0.0
 * Author: Playground
 * License: GPL-2.0+
 */

if (!defined('ABSPATH')) {
    exit;
}

class Playground_Welcome {

    private $option_name = 'playground_welcome_completed';

    public function __construct() {
        add_action('admin_menu', [$this, 'add_admin_page']);
        add_action('admin_init', [$this, 'maybe_redirect_to_welcome']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_styles']);
        add_action('wp_ajax_playground_welcome_save', [$this, 'handle_save']);
    }

    public function add_admin_page() {
        add_menu_page(
            'Welcome',
            'Welcome',
            'manage_options',
            'playground-welcome',
            [$this, 'render_page'],
            'dashicons-welcome-learn-more',
            2
        );
    }

    public function maybe_redirect_to_welcome() {
        if (get_option($this->option_name)) {
            return;
        }

        global $pagenow;
        if ($pagenow === 'admin.php' && isset($_GET['page']) && $_GET['page'] === 'playground-welcome') {
            return;
        }

        if (defined('DOING_AJAX') && DOING_AJAX) {
            return;
        }

        wp_redirect(admin_url('admin.php?page=playground-welcome'));
        exit;
    }

    public function enqueue_styles($hook) {
        if ($hook !== 'toplevel_page_playground-welcome') {
            return;
        }

        wp_enqueue_style(
            'playground-welcome',
            plugin_dir_url(__FILE__) . 'playground-welcome.css',
            [],
            '1.0.0'
        );
    }

    public function render_page() {
        $current_user = wp_get_current_user();
        ?>
        <div class="playground-welcome-overlay">
            <div class="playground-welcome-dialog">
                <h1>👋 Welcome to Your WordPress</h1>
                <p class="intro">While it runs in the browser, it behaves like a traditional WordPress site: Your changes are saved automatically and will be here when you come back. Let's personalize your experience and import some content if you want.</p>

                <form id="playground-welcome-form" method="post">
                    <?php wp_nonce_field('playground_welcome_nonce', 'nonce'); ?>

                    <div class="field-group">
                        <label for="display_name">What's your name?</label>
                        <input
                            type="text"
                            id="display_name"
                            name="display_name"
                            placeholder="<?php echo esc_attr($current_user->display_name); ?>"
                            autofocus
                        >
                    </div>

                    <div class="field-group">
                        <label for="feed_url">Import content from a website (optional)</label>
                        <input
                            type="text"
                            id="feed_url"
                            name="feed_url"
                            placeholder="example.com"
                        >
                        <p class="field-hint">Enter a site URL and we'll find and import its RSS feed.</p>
                    </div>

                    <div class="field-group">
                        <label for="max_items">Maximum posts to import</label>
                        <select id="max_items" name="max_items">
                            <option value="5">5 posts</option>
                            <option value="10" selected>10 posts</option>
                            <option value="20">20 posts</option>
                            <option value="50">50 posts</option>
                        </select>
                    </div>

                    <div id="welcome-message" class="welcome-message" style="display: none;"></div>

                    <div class="button-group">
                        <button type="submit" class="button-primary" id="save-button">
                            <span class="button-text">Get Started</span>
                            <span class="button-loading" style="display: none;">Importing...</span>
                        </button>
                        <a href="<?php echo esc_url(home_url('/')); ?>" class="button-secondary">Skip & Go to Site</a>
                    </div>
                </form>
            </div>
        </div>

        <script>
        document.getElementById('playground-welcome-form').addEventListener('submit', function(e) {
            e.preventDefault();

            const form = this;
            const button = document.getElementById('save-button');
            const buttonText = button.querySelector('.button-text');
            const buttonLoading = button.querySelector('.button-loading');
            const messageEl = document.getElementById('welcome-message');

            button.disabled = true;
            buttonText.style.display = 'none';
            buttonLoading.style.display = 'inline';
            messageEl.style.display = 'none';

            const formData = new FormData(form);
            formData.append('action', 'playground_welcome_save');

            fetch(ajaxurl, {
                method: 'POST',
                body: formData
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    messageEl.className = 'welcome-message success';
                    messageEl.textContent = data.data.message;
                    messageEl.style.display = 'block';

                    setTimeout(() => {
                        window.location.href = '<?php echo esc_url(home_url('/')); ?>';
                    }, 1500);
                } else {
                    messageEl.className = 'welcome-message error';
                    messageEl.textContent = data.data.message || 'An error occurred.';
                    messageEl.style.display = 'block';

                    button.disabled = false;
                    buttonText.style.display = 'inline';
                    buttonLoading.style.display = 'none';
                }
            })
            .catch(error => {
                messageEl.className = 'welcome-message error';
                messageEl.textContent = 'An error occurred. Please try again.';
                messageEl.style.display = 'block';

                button.disabled = false;
                buttonText.style.display = 'inline';
                buttonLoading.style.display = 'none';
            });
        });
        </script>
        <?php
    }

    public function handle_save() {
        if (!wp_verify_nonce($_POST['nonce'], 'playground_welcome_nonce')) {
            wp_send_json_error(['message' => 'Security check failed.']);
        }

        if (!current_user_can('manage_options')) {
            wp_send_json_error(['message' => 'Permission denied.']);
        }

        $messages = [];

        $display_name = sanitize_text_field($_POST['display_name'] ?? '');
        if (!empty($display_name)) {
            $user_id = get_current_user_id();
            wp_update_user([
                'ID' => $user_id,
                'display_name' => $display_name,
            ]);
            update_option('blogname', $display_name . "'s Playground");
            $messages[] = "Name updated to \"{$display_name}\"";
        }

        // Import feed
        $feed_url = trim($_POST['feed_url'] ?? '');
        $max_items = intval($_POST['max_items'] ?? 10);

        if (!empty($feed_url)) {
            if (!preg_match('~^https?://~i', $feed_url)) {
                $feed_url = 'https://' . $feed_url;
            }
            $feed_url = esc_url_raw($feed_url);
            $import_result = $this->import_feed($feed_url, $max_items);
            if ($import_result['success']) {
                $messages[] = $import_result['message'];
            } else {
                wp_send_json_error(['message' => $import_result['message']]);
            }
        }

        $this->update_hello_world_post();
        $this->update_home_template();

        update_option($this->option_name, true);

        $final_message = !empty($messages)
            ? implode('. ', $messages) . '. Redirecting to your site...'
            : 'Setup complete! Redirecting to your site...';

        wp_send_json_success(['message' => $final_message]);
    }

    private function update_home_template() {
        $theme = wp_get_theme();
        $template_file = $theme->get_stylesheet_directory() . '/templates/home.html';

        if (!file_exists($template_file)) {
            return;
        }

        $content = file_get_contents($template_file);
        $pattern = '/\s*<!-- wp:pattern \{"slug":"twentytwentyfive\/hidden-blog-heading"\} \/-->/';
        $updated_content = preg_replace($pattern, '', $content);

        if ($updated_content === $content) {
            return;
        }

        $existing = get_posts([
            'post_type' => 'wp_template',
            'name' => 'home',
            'posts_per_page' => 1,
            'post_status' => 'any',
        ]);

        if (!empty($existing)) {
            wp_update_post([
                'ID' => $existing[0]->ID,
                'post_content' => $updated_content,
            ]);
        } else {
            wp_insert_post([
                'post_type' => 'wp_template',
                'post_name' => 'home',
                'post_title' => 'Blog Home',
                'post_content' => $updated_content,
                'post_status' => 'publish',
                'tax_input' => [
                    'wp_theme' => [$theme->get_stylesheet()],
                ],
            ]);
        }
    }

    private function update_hello_world_post() {
        $post = get_page_by_path('hello-world', OBJECT, 'post');
        if (!$post) {
            $post = get_post(1);
            if (!$post || $post->post_title !== 'Hello world!') {
                return;
            }
        }

        $content = <<<HTML
<!-- wp:paragraph -->
<p>Welcome to this special version of WordPress Playground: While it runs in the browser, it behaves like a traditional WordPress site: Your changes are saved automatically and will be here when you come back.</p>
<!-- /wp:paragraph -->

<!-- wp:heading -->
<h2 class="wp-block-heading">What can you do here?</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">
<li><strong>A space of your own</strong> — WordPress powers much of the web, but here it's just for you. Use it as a notebook, project space, or creative sandbox—no publishing required.</li>
<li><strong>Fully customizable</strong> — Change your theme, organize things however you like. You'll learn WordPress naturally as you go.</li>
</ul>
<!-- /wp:list -->

<!-- wp:heading -->
<h2 class="wp-block-heading">Things to know</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul class="wp-block-list">
<li><strong>It's bound to this browser</strong> — Your Playground lives in this browser's storage, so you can't access it from other devices. This makes it a very private space.</li>
<li><strong>Back up your work</strong> — Use the backup feature in the top menu to save your site. This lets you restore it in another browser or protect against browser storage loss.</li>
<li><strong>Ready to go bigger?</strong> — Move your Playground to dedicated WordPress hosting to access it from any device, share it publicly, or invite specific people to collaborate.</li>
</ul>
<!-- /wp:list -->

<!-- wp:heading -->
<h2 class="wp-block-heading">The top menu</h2>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>Look for the grid icon (<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="20" height="20" aria-hidden="true" focusable="false" style="vertical-align: middle;"><path d="M6 5.5h3a.5.5 0 01.5.5v3a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5zM4 6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2V6zm11-.5h3a.5.5 0 01.5.5v3a.5.5 0 01-.5.5h-3a.5.5 0 01-.5-.5V6a.5.5 0 01.5-.5zM13 6a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2h-3a2 2 0 01-2-2V6zm5 8.5h-3a.5.5 0 00-.5.5v3a.5.5 0 00.5.5h3a.5.5 0 00.5-.5v-3a.5.5 0 00-.5-.5zM15 13a2 2 0 00-2 2v3a2 2 0 002 2h3a2 2 0 002-2v-3a2 2 0 00-2-2h-3zm-9 1.5h3a.5.5 0 01.5.5v3a.5.5 0 01-.5.5H6a.5.5 0 01-.5-.5v-3a.5.5 0 01.5-.5zM4 15a2 2 0 012-2h3a2 2 0 012 2v3a2 2 0 01-2 2H6a2 2 0 01-2-2v-3z" fill-rule="evenodd" clip-rule="evenodd"></path></svg>) in the top bar. From there you can:</p>
<!-- /wp:paragraph -->

<!-- wp:list -->
<ul class="wp-block-list">
<li><strong>Add Features</strong> — We've picked some plugins that work well for private use. The full WordPress plugin directory is there too if you want to explore.</li>
<li><strong>Backups</strong> — Save and restore your site</li>
<li><strong>Start over</strong> — Reset your WordPress or visit <a href="https://playground.wordpress.net" target="_blank">playground.wordpress.net</a> for quick, temporary experiments</li>
</ul>
<!-- /wp:list -->

<!-- wp:paragraph -->
<p>Enjoy your Playground!</p>
<!-- /wp:paragraph -->
HTML;

        wp_update_post([
            'ID' => $post->ID,
            'post_title' => 'Welcome to Your WordPress',
            'post_content' => $content,
            'post_name' => 'welcome-to-your-playground',
        ]);
    }

    private function import_feed($feed_url, $max_items) {
        include_once ABSPATH . WPINC . '/feed.php';

        $feed = fetch_feed($feed_url);

        if (is_wp_error($feed)) {
            return [
                'success' => false,
                'message' => 'Could not fetch feed: ' . $feed->get_error_message()
            ];
        }

        $items = $feed->get_items(0, $max_items);

        if (empty($items)) {
            return [
                'success' => false,
                'message' => 'No items found in the feed.'
            ];
        }

        $imported = 0;
        $current_user_id = get_current_user_id();

        foreach ($items as $item) {
            $title = $item->get_title();
            $content = $item->get_content();
            $date = $item->get_date('Y-m-d H:i:s');
            $permalink = $item->get_permalink();

            $existing = get_posts([
                'post_type' => 'post',
                'meta_key' => '_playground_feed_source',
                'meta_value' => $permalink,
                'posts_per_page' => 1
            ]);

            if (!empty($existing)) {
                continue;
            }

            $content .= "\n\n<p><em>Originally published at <a href=\"" . esc_url($permalink) . "\">" . esc_html(parse_url($permalink, PHP_URL_HOST)) . "</a></em></p>";

            $post_id = wp_insert_post([
                'post_title' => sanitize_text_field($title),
                'post_content' => wp_kses_post($content),
                'post_status' => 'publish',
                'post_author' => $current_user_id,
                'post_date' => $date ?: current_time('mysql'),
            ]);

            if ($post_id && !is_wp_error($post_id)) {
                update_post_meta($post_id, '_playground_feed_source', $permalink);
                $imported++;
            }
        }

        return [
            'success' => true,
            'message' => "Imported {$imported} posts from feed"
        ];
    }
}

new Playground_Welcome();

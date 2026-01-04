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
                <h1>👋 Welcome to WordPress Playground</h1>
                <p class="intro">Let's personalize your experience and add some content to get you started.</p>

                <form id="playground-welcome-form" method="post">
                    <?php wp_nonce_field('playground_welcome_nonce', 'nonce'); ?>

                    <div class="field-group">
                        <label for="display_name">What's your name?</label>
                        <input
                            type="text"
                            id="display_name"
                            name="display_name"
                            value="<?php echo esc_attr($current_user->display_name); ?>"
                            placeholder="Enter your name"
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

        // Update display name and site title
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
                $this->delete_hello_world_post();
            } else {
                wp_send_json_error(['message' => $import_result['message']]);
            }
        } else {
            $this->delete_hello_world_post();
        }

        update_option($this->option_name, true);

        $final_message = !empty($messages)
            ? implode('. ', $messages) . '. Redirecting to your site...'
            : 'Setup complete! Redirecting to your site...';

        wp_send_json_success(['message' => $final_message]);
    }

    private function delete_hello_world_post() {
        $hello_world = get_page_by_path('hello-world', OBJECT, 'post');
        if ($hello_world) {
            wp_delete_post($hello_world->ID, true);
        }

        $post_one = get_post(1);
        if ($post_one && $post_one->post_title === 'Hello world!') {
            wp_delete_post(1, true);
        }
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

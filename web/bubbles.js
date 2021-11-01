(function(){
    // overall gravity toward center
    let to_center = 18;
    // closer to 1: free floating, closer to 0: lots of friction - atmospheric friction?
    let v_friction = 0.3;
    // how hard bubbles push one another away when touching
    let bounce = 0.7;
    // how hard bubbles push one another away when close
    let repulsion = 2;
    // thickness of bubble walls
    let bubble_wall = 5;
    // margin around bubbles
    let bubble_outer_margin = 4;
    // overall reduction of force
    let inertia = 0.5;
    // stickiness of background - forces less than this will be ignored
    let bg_friction = 0.4;
    // available colors
    const r_colors = ["black", "blue", "gray", "green", "red", "orange", "purple", "aqua", "brown", "crimson", "darkcyan", "darkolivegreen", "darkseagreen", "darkslateblue", "darkturquoise", "deeppink", "darkorange", "greenyellow", "goldenrod"];
    /////////
    // colors
    let sel_color = "rgba(255,255,128,128)";  // "#ffff80";
    // all bubbles
    const bubbles = [];
    // start time for previous frame
    let t0 = new Date().getTime();
    //view
    let pan = [0, 0];
    let zoom = 1;
    let the_canvas = null;
    let the_context = null;
    function set_pan_zoom(px, py, z=0) {
        pan = [px, py];
        zoom = z || zoom;
        the_context.setTransform(zoom, 0, 0, zoom, pan[0], pan[1]);
    }
    // utilities
    function surface_tension(surface, fuzz) {
        let i = surface;
        let o = i;
        for (var n_fuzz=0; n_fuzz < fuzz; n_fuzz++) {
            o = []
            const ff = [[-2, 0.1], [-1, 0.25], [0, 0.3], [1, 0.25], [2, 0.1]];
            for (var n = 0; n < i.length; n++) {
                let v = 0;
                for (var nf = 0; nf < ff.length; nf++) {
                    const f0 = ff[nf][0];
                    const f1 = ff[nf][1];
                    v += i[(n + f0 + i.length) % i.length] * f1;
                }
                o.push(v);
            }
            i = o;
        }
        return o;
    }
    //
    class Bubble {
        constructor(x, y, r, color, text="", fixed=false, weight=1, bounce=1) {
            this.x = x;
            this.y = y;
            this.vx = 0;
            this.vy = 0;
            this.r = r;
            this.r2 = r*r;
            this.color = color;
            this.text = text;
            this.weight = weight;
            this.bounce = bounce;
            this.fixed = fixed;
            this.dragging = false;
            this.selected = false;
            this.squish = [];
            this.change_size = 0;
            this.popping = 0;
            this.restore_surface();
        }
        restore_surface() {
            const sq = []
            for (var n=0; n < 100; n++)
                sq.push(this.r);
            this.squish = sq;
        }
        poke(depth, angle, other_d, other_r) {
            const npts = this.squish.length;
            const to_n = 6.284 / npts;
            const ai = Math.round(angle / to_n);
            let c = other_r;
            let b = this.r;
            let a = other_d;
            let w_poke = Math.acos((a*a + b*b - c*c) / (2*a*b));
            if (isNaN(w_poke))
                // entirely inside
                return;
            const max_sq = this.r * 0.85;
            function f(a) {
                var wx = (a - angle)/w_poke;
                var da = Math.cos(1.57 * wx);
                if (da < 0)
                    da = 0
                var dd = da**0.25 * depth;
                return Math.min(dd, max_sq);
            }
            const nr = Math.floor(w_poke / to_n + 0.5);
            for (var n=ai-nr; n <= ai+nr; n ++) {
                const n1 = (n + npts) % npts;
                this.squish[n1] -= f(n * 6.284 / npts);
            }
        }
        draw(ctx) {
            const r = this.r - bubble_outer_margin;
            ctx.beginPath();
            if (this.squish) {
                ctx.lineCap = "round";
                let npts = this.squish.length;
                let a = 0, da = 6.28318 / npts;
                for (var n=0; n < npts+1; n++) {
                    const x = this.x + (this.squish[n%npts] - bubble_outer_margin) * Math.cos(a);
                    const y = this.y + (this.squish[n%npts] - bubble_outer_margin) * Math.sin(a);
                    if (n === 0)
                        ctx.moveTo(x, y)
                    else
                        ctx.lineTo(x, y)
                    a += da;
                }
                if (this.selected)
                    ctx.closePath();
            } else {
                ctx.ellipse(this.x, this.y, r - bubble_wall, r - bubble_wall, 0, 0, 6.284);
                ctx.closePath();
            }
            if (this.popping) {
                // hm
            }
            else if (this.selected) {
                ctx.fillStyle = sel_color;
                ctx.fill()
            }
            const w_h = bubble_wall * Math.max(0.1, Math.log(4*this.weight));
            ctx.lineWidth = w_h;
            if (this.popping)
                ctx.lineWidth = 1;
            ctx.strokeStyle = this.color;
            ctx.stroke();
            if (this.fixed) {
                ctx.lineWidth = ctx.lineWidth / 3;
                ctx.strokeStyle = "white"
                ctx.setLineDash([4, 10])
                ctx.stroke();
                ctx.setLineDash([])
            }
            if (! this.popping) {
                ctx.textAlign = "center";
                ctx.fillStyle = 'black';
                ctx.fillText(this.text, this.x, this.y, this.r * 1.8)
            }
        }
        forces(dt) {
            let fx=0, fy=0;
            const a = this;
            this.restore_surface();
            if (this.popping)
                return [0, 0];
            for (var nb=0; nb < bubbles.length; nb++){
                const b = bubbles[nb];
                if (a === b  ||  b.popping)
                    continue;
                const dx = b.x - a.x, dy = b.y - a.y;
                const r2 = dx*dx + dy*dy;
                // away from other bubbles
                const ab_r2 = a.r2 + b.r2 + 2*a.r*b.r;
                const closeness = r2 - ab_r2;
                const d = Math.sqrt(dx*dx+dy*dy);
                let f_a = 0;
                if (closeness < 0) {
                    // bounciness
                    f_a = Math.sqrt(-closeness) * bounce * this.bounce * dt;
                    // show bounce visually
                    const poke_angle = Math.atan2(dy, dx);
                    let poke_depth = a.r + b.r - d;
                    poke_depth /= 2;
                    this.poke(poke_depth, poke_angle, d, b.r);
                } else if (closeness < 10000) {
                    // mild repulsion
                    f_a = repulsion * dt * 10 / (closeness + 10);
                }
                if (f_a) {
                    fx -= f_a * dx/d;
                    fy -= f_a * dy/d;
                }
            }
            this.squish = surface_tension(this.squish, 3);
            if (this.dragging  ||  this.fixed  ||  this.popping)
                return [0, 0];
            // toward center
            const d0 = Math.sqrt(a.x*a.x + a.y*a.y);
            if (d0 > 30) {
                const f0c = dt * to_center * this.weight;
                fx -= f0c * a.x/d0;
                fy -= f0c * a.y/d0;
            }
            if (Math.abs(fx) < bg_friction)
                fx = 0;
            if (Math.abs(fy) < bg_friction)
                fy = 0;
            return [fx, fy];
        }
        move(dt, friction) {
            const force = this.forces(dt);
            this.vx += force[0];
            this.vy += force[1];
            this.x += this.vx * inertia;
            this.y += this.vy * inertia;
            this.vx *= friction;
            this.vy *= friction;
            if (this.change_size) {
                let amt = dt * 0.8 * this.change_size;
                if (Math.abs(amt) > Math.abs(this.change_size))
                    amt = this.change_size;
                this.r += amt;
                this.r2 = this.r**2;
                this.change_size -= amt;
            }
            if (this.popping) {
                const expand = 0.3 ** dt;
                this.r *= expand;
                this.r2 = this.r ** 2;
                this.popping *= expand;
                if (this.popping < 0.1) {
                    var nb = bubbles.indexOf(this);
                    bubbles.splice(nb, 1);
                }
            }
        }
    }
    function overbubble(x, y) {
        for (var nb=0; nb < bubbles.length; nb++) {
            const b = bubbles[nb];
            const d2 = (x-b.x)*(x-b.x)+(y-b.y)*(y-b.y);
            if (d2 < b.r2) {
                if (b.squish) {
                    let clk_a = Math.atan2(y - b.y, x - b.x) * b.squish.length / 6.284;
                    clk_a = Math.floor((clk_a + b.squish.length) % b.squish.length);
                    const clk_r = b.squish[clk_a];
                    if (d2 < clk_r*clk_r)
                        return b;
                }
            }
        }
    }
    function draw_bubble_form(bubble, area) {
        function refresh() {
            if (! bubble.selected)
                return;
            var h = "";
            h += "<div class='title'>Edit Bubble Data</div>";
            area.innerHTML = h;
            // edit title
            const edit_text = document.createElement("input");
            edit_text.setAttribute("type", "text");
            edit_text.value = bubble.text;
            edit_text.addEventListener("input", function() {
                bubble.text = edit_text.value;
            })
            area.appendChild(edit_text);
            // bigger/smaller
            const btn_bigger = document.createElement("button");
            btn_bigger.innerText = "bigger"
            btn_bigger.addEventListener("click", function() {
                bubble.change_size = bubble.r * 0.10;
            });
            area.appendChild(btn_bigger);
            const btn_smaller = document.createElement("button");
            btn_smaller.innerText = "smaller"
            btn_smaller.addEventListener("click", function() {
                bubble.change_size = -bubble.r * 0.10;
            });
            area.appendChild(btn_smaller);
            // weight
            const edit_weight = document.createElement("input");
            edit_weight.setAttribute("type", "number");
            edit_weight.value = bubble.weight.toFixed(1);
            function set_w(vw) {
                vw = Math.min(vw, 20);
                vw = Math.max(vw, 0.2);
                edit_weight.value = bubble.weight.toFixed(1);
                bubble.weight = vw;
            }
            edit_weight.addEventListener("change", function() {
                let vw = parseFloat(edit_weight.value);
                set_w(vw);
            })
            const btn_heavier = document.createElement("button");
            btn_heavier.innerText = "heavier"
            btn_heavier.addEventListener("click", function() {
                set_w(bubble.weight *= 1.2);
            });
            const btn_lighter = document.createElement("button");
            btn_lighter.innerText = "lighter"
            btn_lighter.addEventListener("click", function() {
                set_w(bubble.weight *= 0.8);
            });
            area.appendChild(edit_weight);
            area.appendChild(btn_heavier);
            area.appendChild(btn_lighter);
            // color
            const btn_color = document.createElement("button");
            btn_color.innerText = "color"
            btn_color.addEventListener("click", function() {
                let nc = r_colors.indexOf(bubble.color);
                bubble.color = r_colors[nc+1];
            });
            area.appendChild(btn_color);
            // pinned
            const btn_pinned = document.createElement("button");
            btn_pinned.innerText = "pinned"
            btn_pinned.addEventListener("click", function() {
                bubble.fixed = ! bubble.fixed;
            });
            area.appendChild(btn_pinned);
            // pop bubble
            const btn_pop = document.createElement("button");
            btn_pop.innerText = "pop"
            btn_pop.addEventListener("click", function() {
                bubble.popping = 1;
                bubble.restore_surface();
            });
            area.appendChild(btn_pop);
            //
            if (bubble.selected) {
                setTimeout(refresh, 60000);
            }
        }
        refresh();
    }
    function drag_and_select() {
        const canvas = the_canvas
        var onbubble = null;
        var start = null;
        var move00 = null, move0 = null, move1 = null;
        var pan0 = null;
        var clicked = false;
        var panel = document.getElementById("panel");
        // set up tools
        document.getElementById("zoom-in").addEventListener("click", function(){
            set_pan_zoom(pan[0], pan[1], zoom*1.25)
        });
        document.getElementById("zoom-out").addEventListener("click", function(){
            set_pan_zoom(pan[0], pan[1], zoom*(1/1.25))
        });
        function to_ctx_coords(evt) {
            return [(evt.offsetX - pan[0])/zoom, (evt.offsetY - pan[1])/zoom];
        }
        function select_bubble(bubble) {
            const select = ! bubble.selected;
            // deselect all bubbles
            for (var nb=0; nb < bubbles.length; nb++)
                bubbles[nb].selected = false;
            if (bubble && select) {
                // select bubble
                bubble.selected = true;
                draw_bubble_form(bubble, panel);
                panel.style.display = 'block';
            } else {
                panel.innerText = "";
                panel.style.display = 'none';
            }
        }
        function create_bubble(at) {
            const c = r_colors[Math.floor(Math.random()*r_colors.length)];
            const bubble = new Bubble(at[0], at[1], 50, c);
            bubbles.push(bubble);
            select_bubble(bubble);
        }
        canvas.addEventListener("dblclick", function(evt) {
            create_bubble(to_ctx_coords(evt));
        });
        canvas.addEventListener("mousedown", function(evt){
            const pos = to_ctx_coords(evt);
            clicked = true;
            onbubble = overbubble(pos[0], pos[1]);
            select_bubble(onbubble);
            if (onbubble) {
                onbubble.dragging = true;
                onbubble.vx = 0;
                onbubble.vy = 0;
                start = [pos[0] - onbubble.x, pos[1] - onbubble.y];
            }
            move00 = [pos[0], pos[1], new Date().getTime()]
            move0 = move1 = null;
            pan0 = [pan[0], pan[1]];
        });
        canvas.addEventListener("mouseup", function(){
            clicked = false;
            if (onbubble) {
                onbubble.dragging = false;
                // 'throw' it
                if (move0 && move1) {
                    const dx = move1[0] - move0[0];
                    const dy = move1[1] - move0[1];
                    const dt = move1[2] - move0[2];
                    onbubble.vx += 20*dx*onbubble.weight / dt;
                    onbubble.vy += 20*dy*onbubble.weight / dt;
                }
            }
            onbubble = null;
        });
        canvas.addEventListener("mousemove", function(evt){
            const pos = to_ctx_coords(evt);
            const move = [pos[0], pos[1], new Date().getTime()]
            move0 = move1;
            move1 = move;
            if (onbubble) {
                // drag
                onbubble.x = pos[0] - start[0];
                onbubble.y = pos[1] - start[1];
            } else if (clicked) {
                // pan
                const dx = move[0] - move00[0];
                const dy = move[1] - move00[1];
                const z = zoom;
                // FIXME this is jumpy for some reason
                set_pan_zoom(pan0[0] + dx*z, pan0[1] + dy*z);
            }
        });
    }
    function frame() {
        const ctx = the_context;
        const z = zoom;
        //ctx.clearRect(-the_canvas.width/2, -the_canvas.height/2, the_canvas.width, the_canvas.height)
        ctx.clearRect(-pan[0]/z, -pan[1]/z, the_canvas.width/z, the_canvas.height/z)
        const t = new Date().getTime();
        const dt = Math.min(t - t0, 0.1);
        const friction = v_friction**dt;
        t0 = t;
        for (var nb=0; nb < bubbles.length; nb++){
            bubbles[nb].move(dt, friction);
            bubbles[nb].draw(ctx);
        }
    }
    function add_random_bubble() {
        var px = Math.random()*900 - 450;
        var py = Math.random()*900 - 450;
        var r = Math.random()*80 + 20;
        var c = r_colors[Math.floor(Math.random()*r_colors.length)];
        bubbles.push(new Bubble(px, py, r, c, ''));
    }
    function setup(mode) {
        const canvas = document.getElementById("view");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        the_canvas = canvas;
        the_context = canvas.getContext('2d');
        set_pan_zoom(canvas.width/2, canvas.height/2, 1);
        // start bubble animations
        setInterval(function(){ frame(); }, 50);
        if (mode === "demo" || false) {
            bubbles.push(new Bubble(0, 0, 140, 'blue', 'bubbles!', true));
            for (var nb=0; nb < 25; nb++)
                add_random_bubble();
            function updates() {
                if (Math.random() < 0.1 && bubbles.length < 40)
                    add_random_bubble();
                if (Math.random() < 0.1 && bubbles.length > 10) {
                    nb = Math.floor(Math.random()*(bubbles.length - 1)) + 1;
                    bubbles[nb].popping = 1;
                }
            }
            setInterval(updates, 150);
        } else {
            bubbles.push(new Bubble(0, 0, 140, 'blue', 'double click to add a bubble, click to change or drag', true));
            // make bubbles draggable
            drag_and_select();
        }
    }
    window.addEventListener("load", setup);
})();

/*
 TODO...

 pan is jumpy
 multi-line description entry, multi-line display in bubbles
 choose which bubble to drift toward
 start in demo mode
   start button, save/restore
 ground-down mode, or place a boundary
 hover to see details
 JIRA link per bubble

 instructions
   double click to create new bubble

 */
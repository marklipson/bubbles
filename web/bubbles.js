(function(){
    // overall gravity toward center
    let to_center = 18;
    // closer to 1: free floating, closer to 0: lots of friction - atmospheric friction?
    let v_friction = 0.1;
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
    // all bubbles
    const bubbles = [];
    // start time for previous frame
    let t0 = new Date().getTime();
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
        constructor(x, y, r, color, text="", fixed=false, gravity=1, bounce=1) {
            this.x = x;
            this.y = y;
            this.vx = 0;
            this.vy = 0;
            this.r = r;
            this.r2 = r*r;
            this.color = color;
            this.text = text;
            this.gravity = gravity;
            this.bounce = bounce;
            this.fixed = fixed;
            this.dragging = false;
            this.squish = [];
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
            this.text = w_poke.toFixed(1);
            const max_sq = this.r * 0.85;
            function f(a) {
                var wx = (a - angle)/w_poke;
                var da = Math.cos(1.57 * wx);
                if (da < 0)
                    da = 0
                var dd = da**0.25 * depth;
                return Math.min(dd, max_sq);
            }
            //const min_sq = this.r*0.3;
            const nr = Math.floor(w_poke / to_n + 0.5);
            for (var n=ai-nr; n <= ai+nr; n ++) {
                const n1 = (n + npts) % npts;
                this.squish[n1] -= f(n * 6.284 / npts);
                //if (this.squish[n1] < min_sq)
                //    this.squish[n1] = min_sq;
            }
        }
        draw(ctx) {
            const r = this.r - bubble_outer_margin;
            ctx.strokeStyle = this.color;
            ctx.lineWidth = bubble_wall;
            ctx.beginPath();
            if (this.squish) {
                ctx.lineCap = "round";
                let npts = this.squish.length;
                let a = 0, da = 6.284 / npts;
                for (var n=0; n < npts+1; n++) {
                    const x = this.x + (this.squish[n%npts] - bubble_outer_margin) * Math.cos(a);
                    const y = this.y + (this.squish[n%npts] - bubble_outer_margin) * Math.sin(a);
                    if (n === 0)
                        ctx.moveTo(x, y)
                    else
                        ctx.lineTo(x, y)
                    a += da;
                }
            } else {
                ctx.ellipse(this.x, this.y, r - bubble_wall, r - bubble_wall, 0, 0, 6.284);
                ctx.closePath();
            }
            ctx.stroke();
            ctx.textAlign = "center";
            ctx.fillText(this.text, this.x, this.y, this.r*1.8)
        }
        forces(dt) {
            if (this.fixed)
                return [0, 0];
            let fx=0, fy=0;
            const a = this;
            this.restore_surface();
            for (var nb=0; nb < bubbles.length; nb++){
                const b = bubbles[nb];
                if (a === b)
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
                    //this.text = poke_depth.toFixed(2);
                    if (! b.fixed)
                        poke_depth /= 2;
                    this.poke(poke_depth, poke_angle, d, b.r);
                    //this.text = poke_depth.toFixed(2);
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
            if (this.dragging)
                return [0, 0];
            // toward center
            const d0 = Math.sqrt(a.x*a.x + a.y*a.y);
            if (d0 > 30) {
                const f0c = dt * to_center * this.gravity;
                fx -= f0c * a.x/d0;
                fy -= f0c * a.y/d0;
            }
            if (Math.abs(fx) < bg_friction)
                fx = 0;
            if (Math.abs(fy) < bg_friction)
                fy = 0;
            //this.text = "(" + fx.toFixed(2) + ", " + fy.toFixed(2) + ")"
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
        }
    }
    function overbubble(x, y) {
        for (var nb=0; nb < bubbles.length; nb++) {
            const b = bubbles[nb];
            const d2 = (x-b.x)*(x-b.x)+(y-b.y)*(y-b.y);
            if (d2 < b.r2)
                return b;
        }
    }
    function draggability(canvas) {
        var onbubble = null;
        var start = null;
        var center = [canvas.width/2, canvas.height/2];
        function to_ctx_coords(evt) {
            return [evt.x - center[0], evt.y - center[1]];
        }
        canvas.addEventListener("mousedown", function(evt){
            const pos = to_ctx_coords(evt);
            onbubble = overbubble(pos[0], pos[1]);
            if (onbubble) {
                onbubble.dragging = true;
                start = [pos[0] - onbubble.x, pos[1] - onbubble.y];
            }
        });
        canvas.addEventListener("mouseup", function(){
            if (onbubble)
                onbubble.dragging = false;
            onbubble = null;
        });
        canvas.addEventListener("mousemove", function(evt){
            if (onbubble) {
                const pos = to_ctx_coords(evt);
                onbubble.x = pos[0] - start[0];
                onbubble.y = pos[1] - start[1];

            }
        });
    }
    function frame(canvas, ctx) {
        ctx.clearRect(-canvas.width/2, -canvas.height/2, canvas.width, canvas.height);
        const t = new Date().getTime();
        const dt = Math.min(t - t0, 0.1);
        const friction = v_friction**dt;
        t0 = t;
        for (var nb=0; nb < bubbles.length; nb++){
            bubbles[nb].move(dt, friction);
            bubbles[nb].draw(ctx);
        }
    }
    function setup() {
        const canvas = document.getElementById("view");
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        const ctx = canvas.getContext('2d');
        ctx.translate(canvas.width/2, canvas.height/2);
        // start bubble animations
        setInterval(function(){ frame(canvas, ctx); }, 50);
        // make bubbles draggable
        draggability(canvas);
        bubbles.push(new Bubble(0, 0, 140, 'blue', 'a', true));
        bubbles.push(new Bubble(-200, 300, 120, 'green', 'g', false, 3));
        /* */
        const r_colors = ["black", "blue", "gray", "yellow", "green", "red", "orange", "purple"];
        bubbles.push(new Bubble(400, -150, 40, 'red', 'r'));
        for (var nb=0; nb < 25; nb++) {
            var px = Math.random()*900 - 450;
            var py = Math.random()*900 - 450;
            var r = Math.random()*70 + 25;
            var c = r_colors[Math.floor(Math.random()*r_colors.length)];
            bubbles.push(new Bubble(px, py, r, c, '*'));
        }
        /* */
    }
    window.addEventListener("load", setup);
})();

